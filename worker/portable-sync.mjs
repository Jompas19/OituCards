const SESSION_DAYS = 90;
const MAX_PUSH_BYTES = 5 * 1024 * 1024;
const MAX_MEDIA_PUSH_BYTES = 9 * 1024 * 1024;
const MAX_ITEM_BYTES = 1_700_000;
const MAX_MEDIA_BYTES = 64 * 1024 * 1024;
const PASSWORD_ITERATIONS = 120000;
const PASSWORD_PROOF_SCHEME = "client-pbkdf2-v1";
const PROFILE_KEY = "p:profile";

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers
    }
  });
}

function normalizeUsername(value) {
  const username = String(value || "").normalize("NFKC").trim().toLocaleLowerCase("pt-BR");
  if (username.length < 3 || username.length > 32 || !/^[\p{L}\p{N}._-]+$/u.test(username)) return null;
  return username;
}

function encodeBase64Url(bytes) {
  let binary = "";
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let index = 0; index < view.length; index += 1) binary += String.fromCharCode(view[index]);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

async function sha256(value) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  return encodeBase64Url(await crypto.subtle.digest("SHA-256", bytes));
}

async function passwordDigest(password, salt) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits({
    name: "PBKDF2",
    hash: "SHA-256",
    salt: new TextEncoder().encode(salt),
    iterations: PASSWORD_ITERATIONS
  }, key, 256);
  return encodeBase64Url(bits);
}

function randomToken(size = 32) {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return encodeBase64Url(bytes);
}

function safeEqual(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (a.charCodeAt(index % Math.max(1, a.length)) || 0) ^
      (b.charCodeAt(index % Math.max(1, b.length)) || 0);
  }
  return difference === 0;
}

function validIdentifier(value) {
  return typeof value === "string" && value.length >= 1 && value.length <= 160;
}

function incomingWins(current, modifiedAt, deviceId) {
  if (!current) return true;
  const currentTime = Number(current.client_modified_at) || 0;
  if (modifiedAt !== currentTime) return modifiedAt > currentTime;
  return String(deviceId || "") > String(current.device_id || "");
}

function encoded(value) {
  return encodeURIComponent(String(value));
}

function itemKey(kind, id) {
  return `i:${kind}:${encoded(id)}`;
}

function mediaKey(id) {
  return `m:${encoded(id)}`;
}

function sessionKey(tokenHash) {
  return `s:${tokenHash}`;
}

function changeKey(version) {
  return `c:${String(Math.max(0, Number(version) || 0)).padStart(16, "0")}`;
}

function mediaChunkKey(id, index) {
  return `mc:${encoded(id)}:${String(index).padStart(4, "0")}`;
}

function deckCardKey(deckId, cardId) {
  return `dc:${encoded(deckId)}:${encoded(cardId)}`;
}

function deckCardPrefix(deckId) {
  return `dc:${encoded(deckId)}:`;
}

function mediaDeckKey(deckId, mediaId) {
  return `md:${encoded(deckId)}:${encoded(mediaId)}`;
}

function mediaDeckPrefix(deckId) {
  return `md:${encoded(deckId)}:`;
}

function idFromIndexKey(key, prefix) {
  try { return decodeURIComponent(key.slice(prefix.length)); }
  catch (_) { return null; }
}

function split(values, size) {
  const groups = [];
  for (let index = 0; index < values.length; index += size) groups.push(values.slice(index, index + size));
  return groups;
}

export class PortableSyncStore {
  constructor(ctx) {
    this.storage = ctx.storage;
    this.kv = ctx.storage.kv || null;
    this.phase = null;
  }

  async get(key) {
    return this.kv ? this.kv.get(key) : this.storage.get(key);
  }

  async put(key, value) {
    if (this.kv) {
      this.kv.put(key, value);
      return;
    }
    await this.storage.put(key, value);
  }

  async remove(key) {
    return this.kv ? this.kv.delete(key) : this.storage.delete(key);
  }

  async list(options) {
    return this.kv ? new Map(this.kv.list(options)) : this.storage.list(options);
  }

  async getMany(keys) {
    const result = new Map();
    const unique = [...new Set(keys.filter(Boolean))];
    if (this.kv) {
      for (const key of unique) {
        const value = this.kv.get(key);
        if (value !== undefined) result.set(key, value);
      }
      return result;
    }
    for (const group of split(unique, 100)) {
      const rows = await this.storage.get(group);
      if (rows instanceof Map) rows.forEach((value, key) => result.set(key, value));
      else if (group.length === 1 && rows !== undefined) result.set(group[0], rows);
    }
    return result;
  }

  async putMany(entries) {
    const values = entries instanceof Map ? [...entries.entries()] : entries;
    if (this.kv) {
      const apply = () => {
        for (const [key, value] of values) this.kv.put(key, value);
      };
      if (typeof this.storage.transactionSync === "function") this.storage.transactionSync(apply);
      else apply();
      return;
    }
    for (const group of split(values, 128)) {
      const record = {};
      for (const [key, value] of group) record[key] = value;
      await this.storage.put(record);
    }
  }

  async deleteMany(keys) {
    const unique = [...new Set(keys.filter(Boolean))];
    if (this.kv) {
      const apply = () => unique.forEach((key) => this.kv.delete(key));
      if (typeof this.storage.transactionSync === "function") this.storage.transactionSync(apply);
      else apply();
      return;
    }
    for (const group of split(unique, 128)) await this.storage.delete(group);
  }

  async listKeys(prefix) {
    const keys = [];
    let startAfter = null;
    while (true) {
      const rows = await this.list({ prefix, ...(startAfter ? { startAfter } : {}), limit: 1000 });
      const page = [...rows.keys()];
      if (!page.length) break;
      keys.push(...page);
      if (page.length < 1000) break;
      startAfter = page[page.length - 1];
    }
    return keys;
  }

  async cascadeDeckDelete(deckId, modifiedAt, deviceId, puts, deletes, nextVersion) {
    const cardPrefix = deckCardPrefix(deckId);
    const storedCardIndexes = await this.listKeys(cardPrefix);
    const pendingCardIndexes = [...puts.keys()].filter((key) => key.startsWith(cardPrefix));
    const cardIndexes = [...new Set([...storedCardIndexes, ...pendingCardIndexes])];
    const cardKeys = cardIndexes.map((key) => {
      const cardId = idFromIndexKey(key, cardPrefix);
      return cardId ? itemKey("card", cardId) : null;
    }).filter(Boolean);
    const storedCards = await this.getMany(cardKeys.filter((key) => !puts.has(key)));
    cardIndexes.forEach((indexKey, index) => {
      const cardKey = cardKeys[index];
      const card = puts.get(cardKey) || storedCards.get(cardKey);
      if (card?.version) {
        deletes.add(changeKey(card.version));
        puts.delete(changeKey(card.version));
      }
      deletes.add(indexKey);
      deletes.add(cardKey);
      puts.delete(indexKey);
      puts.delete(cardKey);
    });

    const mediaPrefix = mediaDeckPrefix(deckId);
    const mediaIndexes = await this.listKeys(mediaPrefix);
    const mediaIds = mediaIndexes.map((key) => idFromIndexKey(key, mediaPrefix)).filter(Boolean);
    const mediaRows = await this.getMany(mediaIds.map(mediaKey));
    for (let index = 0; index < mediaIds.length; index += 1) {
      const mediaId = mediaIds[index];
      const key = mediaKey(mediaId);
      const media = puts.get(key) || mediaRows.get(key);
      deletes.add(mediaIndexes[index]);
      puts.delete(mediaIndexes[index]);
      if (!media) continue;
      if (media.version) {
        deletes.add(changeKey(media.version));
        puts.delete(changeKey(media.version));
      }
      const remaining = [...new Set((Array.isArray(media.deck_ids) ? media.deck_ids : []).filter((id) => id !== deckId))];
      if (!remaining.length) {
        deletes.add(key);
        puts.delete(key);
        for (let chunk = 0; chunk < Number(media.total_chunks); chunk += 1) {
          deletes.add(mediaChunkKey(mediaId, chunk));
          puts.delete(mediaChunkKey(mediaId, chunk));
        }
        continue;
      }
      const version = nextVersion();
      const updated = {
        ...media,
        deck_ids: remaining,
        version,
        client_modified_at: modifiedAt,
        device_id: deviceId
      };
      puts.set(key, updated);
      puts.set(changeKey(version), { type: "media", id: mediaId, version });
    }
  }

  async profile() {
    return (await this.get(PROFILE_KEY)) || null;
  }

  async passwordInfo() {
    const profile = await this.profile();
    const legacy = Boolean(profile?.password_hash && profile.password_salt !== PASSWORD_PROOF_SCHEME);
    return json({
      protected: Boolean(profile?.password_hash),
      scheme: legacy ? "legacy-pbkdf2" : PASSWORD_PROOF_SCHEME,
      salt: legacy ? profile.password_salt : null
    });
  }

  async createSession(request) {
    this.phase = "session-parse";
    const length = Number(request.headers.get("content-length")) || 0;
    if (length > 8192) return json({ error: "Solicitação inválida." }, 413);
    let body;
    try {
      const raw = await request.text();
      if (new TextEncoder().encode(raw).byteLength > 8192) return json({ error: "Solicitação inválida." }, 413);
      body = JSON.parse(raw);
    } catch (_) {
      return json({ error: "Solicitação inválida." }, 400);
    }

    const username = normalizeUsername(body?.username);
    const password = typeof body?.password === "string" ? body.password : "";
    const passwordProof = typeof body?.passwordProof === "string" ? body.passwordProof : "";
    const legacyPasswordProof = typeof body?.legacyPasswordProof === "string" ? body.legacyPasswordProof : "";
    const deviceId = String(body?.deviceId || "");
    const validProofs = (!passwordProof || /^[A-Za-z0-9_-]{43}$/.test(passwordProof)) &&
      (!legacyPasswordProof || /^[A-Za-z0-9_-]{43}$/.test(legacyPasswordProof));
    if (!username || !validIdentifier(deviceId) || password.length > 72 || !validProofs) {
      return json({ error: "Confira o usuário e a senha informados." }, 400);
    }

    const now = Date.now();
    this.phase = "session-profile-read";
    let profile = await this.profile();
    let created = false;
    if (!profile) {
      const protectedProfile = Boolean(password || passwordProof);
      const salt = protectedProfile ? (passwordProof ? PASSWORD_PROOF_SCHEME : randomToken(18)) : null;
      const digest = protectedProfile
        ? (passwordProof ? await sha256(`${PASSWORD_PROOF_SCHEME}:${passwordProof}`) : await passwordDigest(password, salt))
        : null;
      profile = {
        username,
        password_hash: digest,
        password_salt: salt,
        source_device_id: deviceId,
        seq: 0,
        failed_attempts: 0,
        locked_until: 0,
        created_at: now,
        updated_at: now
      };
      this.phase = "session-profile-create";
      await this.put(PROFILE_KEY, profile);
      created = true;
    } else {
      if (profile.username !== username) return json({ error: "Usuário inválido." }, 403);
      if (Number(profile.locked_until) > now) {
        return json({ error: "Muitas tentativas. Aguarde alguns minutos e tente novamente." }, 429);
      }
      if (profile.password_hash) {
        const digest = profile.password_salt === PASSWORD_PROOF_SCHEME
          ? (passwordProof ? await sha256(`${PASSWORD_PROOF_SCHEME}:${passwordProof}`) : "")
          : (legacyPasswordProof || await passwordDigest(password, profile.password_salt));
        if (!safeEqual(digest, profile.password_hash)) {
          const attempts = (Number(profile.failed_attempts) || 0) + 1;
          const lockMs = attempts >= 5 ? Math.min(15 * 60 * 1000, 30000 * 2 ** Math.min(5, attempts - 5)) : 0;
          profile = { ...profile, failed_attempts: attempts, locked_until: lockMs ? now + lockMs : 0, updated_at: now };
          this.phase = "session-profile-lock";
          await this.put(PROFILE_KEY, profile);
          return json({ error: "Usuário ou senha incorretos." }, attempts >= 5 ? 429 : 403);
        }
        if (profile.password_salt !== PASSWORD_PROOF_SCHEME && passwordProof) {
          profile = {
            ...profile,
            password_hash: await sha256(`${PASSWORD_PROOF_SCHEME}:${passwordProof}`),
            password_salt: PASSWORD_PROOF_SCHEME
          };
        }
      }
      profile = {
        ...profile,
        source_device_id: profile.source_device_id || deviceId,
        failed_attempts: 0,
        locked_until: 0,
        updated_at: now
      };
      this.phase = "session-profile-update";
      await this.put(PROFILE_KEY, profile);
    }

    this.phase = "session-token-create";
    const token = randomToken();
    this.phase = "session-token-hash";
    const tokenHash = await sha256(token);
    const expiresAt = now + SESSION_DAYS * 24 * 60 * 60 * 1000;
    this.phase = "session-token-write";
    await this.put(sessionKey(tokenHash), { device_id: deviceId, expires_at: expiresAt, created_at: now });
    this.phase = null;
    return json({
      token,
      username,
      created,
      protected: Boolean(profile.password_hash),
      isSourceDevice: profile.source_device_id === deviceId,
      currentVersion: Number(profile.seq) || 0,
      expiresAt
    });
  }

  async authenticate(request) {
    const authorization = request.headers.get("authorization") || "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
    if (!token) return null;
    const tokenHash = await sha256(token);
    const key = sessionKey(tokenHash);
    const session = await this.get(key);
    if (!session || Number(session.expires_at) <= Date.now()) {
      if (session) await this.remove(key);
      return null;
    }
    let profile = await this.profile();
    if (profile && !profile.source_device_id) {
      profile = { ...profile, source_device_id: session.device_id, updated_at: Date.now() };
      await this.put(PROFILE_KEY, profile);
    }
    return { ...session, tokenHash, isSourceDevice: profile?.source_device_id === session.device_id };
  }

  async push(request, session) {
    const length = Number(request.headers.get("content-length")) || 0;
    if (length > MAX_PUSH_BYTES) return json({ error: "Lote de sincronização muito grande." }, 413);
    let body;
    try {
      const raw = await request.text();
      if (new TextEncoder().encode(raw).byteLength > MAX_PUSH_BYTES) return json({ error: "Lote de sincronização muito grande." }, 413);
      body = JSON.parse(raw);
    } catch (_) {
      return json({ error: "Lote de sincronização inválido." }, 400);
    }
    const mutations = Array.isArray(body?.mutations) ? body.mutations : [];
    if (!mutations.length || mutations.length > 300) return json({ error: "Lote de sincronização inválido." }, 400);

    let profile = await this.profile();
    if (!profile) return json({ error: "Perfil de sincronização não encontrado." }, 409);
    const keys = [];
    for (const mutation of mutations) {
      const kind = String(mutation?.kind || "");
      const id = String(mutation?.id || "");
      if (["deck", "folder", "card"].includes(kind) && validIdentifier(id)) keys.push(itemKey(kind, id));
      if (kind === "card" && validIdentifier(String(mutation?.payload?.deckId || ""))) {
        keys.push(itemKey("deck", String(mutation.payload.deckId)));
      }
    }
    const state = await this.getMany(keys);
    const puts = new Map();
    const deletes = new Set();
    let sequence = Number(profile.seq) || 0;
    let accepted = 0;

    for (const mutation of mutations) {
      const kind = String(mutation?.kind || "");
      const id = String(mutation?.id || "");
      const operation = mutation?.op === "delete" ? "delete" : "upsert";
      if (!["deck", "folder", "card"].includes(kind) || !validIdentifier(id)) continue;
      const key = itemKey(kind, id);
      const current = state.get(key) || null;
      const modifiedAt = Math.max(1, Number(mutation.modifiedAt) || Date.now());
      if (!incomingWins(current, modifiedAt, session.device_id)) continue;

      let parentId = current?.parent_id || null;
      let payload = null;
      if (operation === "upsert") {
        if (!mutation.payload || typeof mutation.payload !== "object" || String(mutation.payload.id || id) !== id) continue;
        payload = JSON.stringify({ ...mutation.payload, id });
        if (new TextEncoder().encode(payload).byteLength > MAX_ITEM_BYTES) continue;
        parentId = kind === "card" ? String(mutation.payload.deckId || "") :
          kind === "deck" ? (mutation.payload.folderId ? String(mutation.payload.folderId) : null) :
          (mutation.payload.parentId ? String(mutation.payload.parentId) : null);
        if (kind === "card" && !validIdentifier(parentId)) continue;
        if (kind === "card") {
          const parentKey = itemKey("deck", parentId);
          const parent = state.get(parentKey) || puts.get(parentKey);
          if (parent?.deleted && Number(parent.client_modified_at) >= modifiedAt) continue;
        }
        if (current && !current.deleted && Number(current.client_modified_at) === modifiedAt &&
          current.parent_id === parentId && current.payload === payload) continue;
      } else if (current?.deleted && Number(current.client_modified_at) === modifiedAt) {
        continue;
      }

      sequence += 1;
      const record = {
        kind,
        id,
        parent_id: parentId,
        payload,
        deleted: operation === "delete",
        version: sequence,
        client_modified_at: modifiedAt,
        device_id: session.device_id
      };
      if (current?.version) {
        const oldChange = changeKey(current.version);
        deletes.add(oldChange);
        puts.delete(oldChange);
      }
      if (kind === "card" && current?.parent_id && current.parent_id !== parentId) {
        deletes.add(deckCardKey(current.parent_id, id));
      }
      if (kind === "card") {
        const indexKey = deckCardKey(parentId, id);
        if (record.deleted) deletes.add(indexKey);
        else puts.set(indexKey, true);
      }
      puts.set(key, record);
      puts.set(changeKey(sequence), { type: "item", kind, id, version: sequence });
      state.set(key, record);
      accepted += 1;
      if (kind === "deck" && record.deleted) {
        await this.cascadeDeckDelete(id, modifiedAt, session.device_id, puts, deletes, () => {
          sequence += 1;
          return sequence;
        });
      }
    }

    if (accepted) {
      profile = { ...profile, seq: sequence, updated_at: Date.now() };
      puts.set(PROFILE_KEY, profile);
      await this.deleteMany([...deletes]);
      await this.putMany(puts);
    }
    return json({ accepted, currentVersion: sequence });
  }

  async pushMedia(request, session) {
    const length = Number(request.headers.get("content-length")) || 0;
    if (length > MAX_MEDIA_PUSH_BYTES) return json({ error: "Lote de imagens muito grande." }, 413);
    let form;
    try { form = await request.formData(); }
    catch (_) { return json({ error: "Lote de imagens inválido." }, 400); }
    let manifest;
    try { manifest = JSON.parse(String(form.get("manifest") || "")); }
    catch (_) { return json({ error: "Lote de imagens inválido." }, 400); }
    const entries = Array.isArray(manifest?.media) ? manifest.media : [];
    if (!entries.length || entries.length > 64) return json({ error: "Lote de imagens inválido." }, 400);

    const prepared = [];
    let aggregateBytes = 0;
    let aggregateParts = 0;
    for (const entry of entries) {
      if (!validIdentifier(entry?.id) || !validIdentifier(entry?.uploadId)) {
        return json({ error: "Uma imagem do lote é inválida." }, 400);
      }
      const size = Number(entry.size) || 0;
      const totalChunks = Number(entry.totalChunks) || 0;
      const parts = Array.isArray(entry.parts) ? entry.parts : [];
      if (size < 1 || size > MAX_MEDIA_BYTES || totalChunks < 1 || totalChunks > 64 || !parts.length || parts.length > 16) {
        return json({ error: "Uma imagem excede o limite permitido." }, 413);
      }
      const buffers = [];
      for (const part of parts) {
        const file = form.get(String(part.key || ""));
        const index = Number(part.index);
        if (!file || typeof file.arrayBuffer !== "function" || !Number.isInteger(index) || index < 0 || index >= totalChunks || file.size > 1100000) {
          return json({ error: "Um bloco de imagem é inválido." }, 400);
        }
        buffers.push({ index, data: await file.arrayBuffer() });
        aggregateBytes += file.size;
        aggregateParts += 1;
        if (aggregateBytes > MAX_MEDIA_PUSH_BYTES || aggregateParts > 16) {
          return json({ error: "Lote de imagens muito grande." }, 413);
        }
      }
      prepared.push({ entry, size, totalChunks, buffers });
    }

    let profile = await this.profile();
    if (!profile) return json({ error: "Perfil de sincronização não encontrado." }, 409);
    let sequence = Number(profile.seq) || 0;
    let completed = 0;
    const puts = new Map();
    const deletes = new Set();

    for (const item of prepared) {
      const entry = item.entry;
      const key = mediaKey(entry.id);
      let current = await this.get(key);
      const modifiedAt = Math.max(1, Number(entry.modifiedAt) || Date.now());
      const incomingName = String(entry.name || "imagem").slice(0, 255);
      const incomingMime = String(entry.mime || "application/octet-stream").slice(0, 120);
      const incomingDeckIds = Array.isArray(entry.deckIds)
        ? [...new Set(entry.deckIds.filter(validIdentifier))].slice(0, 200)
        : [];
      const unchangedCompleteMedia = current?.complete && !current.deleted &&
        Number(current.client_modified_at) === modifiedAt && Number(current.size) === item.size &&
        current.name === incomingName && current.mime === incomingMime &&
        JSON.stringify(current.deck_ids || []) === JSON.stringify(incomingDeckIds);
      if (unchangedCompleteMedia) continue;
      if (current?.upload_id !== entry.uploadId) {
        const restartingOwnIncompleteUpload = current && !current.complete &&
          Number(current.client_modified_at) === modifiedAt && current.device_id === session.device_id;
        if (!restartingOwnIncompleteUpload && !incomingWins(current, modifiedAt, session.device_id)) continue;
        if (current?.total_chunks) {
          for (let index = 0; index < Number(current.total_chunks); index += 1) deletes.add(mediaChunkKey(entry.id, index));
        }
        if (current?.version) deletes.add(changeKey(current.version));
        for (const deckId of Array.isArray(current?.deck_ids) ? current.deck_ids : []) {
          deletes.add(mediaDeckKey(deckId, entry.id));
        }
        current = {
          id: entry.id,
          name: incomingName,
          mime: incomingMime,
          size: item.size,
          deck_ids: incomingDeckIds,
          upload_id: entry.uploadId,
          total_chunks: item.totalChunks,
          received_chunks: [],
          complete: false,
          deleted: false,
          version: 0,
          client_modified_at: modifiedAt,
          device_id: session.device_id
        };
        for (const deckId of incomingDeckIds) puts.set(mediaDeckKey(deckId, entry.id), true);
      }
      const received = new Set(Array.isArray(current.received_chunks) ? current.received_chunks : []);
      for (const chunk of item.buffers) {
        puts.set(mediaChunkKey(entry.id, chunk.index), chunk.data);
        received.add(chunk.index);
      }
      current = { ...current, received_chunks: [...received].sort((a, b) => a - b) };
      if (!current.complete && received.size === Number(current.total_chunks)) {
        sequence += 1;
        current.complete = true;
        current.version = sequence;
        puts.set(changeKey(sequence), { type: "media", id: entry.id, version: sequence });
        completed += 1;
      }
      puts.set(key, current);
    }

    if (sequence !== Number(profile.seq || 0)) {
      profile = { ...profile, seq: sequence, updated_at: Date.now() };
      puts.set(PROFILE_KEY, profile);
    }
    await this.deleteMany([...deletes]);
    await this.putMany(puts);
    return json({ completed, currentVersion: sequence });
  }

  async pull(url, session) {
    const since = Math.max(0, Number(url.searchParams.get("since")) || 0);
    const limit = Math.max(1, Math.min(500, Number(url.searchParams.get("limit")) || 500));
    const profile = await this.profile();
    const currentVersion = Number(profile?.seq) || 0;
    const logs = await this.list({ start: changeKey(since + 1), end: "c;", limit });
    const descriptors = [...logs.values()];
    const records = await this.getMany(descriptors.map((entry) => entry.type === "media"
      ? mediaKey(entry.id)
      : itemKey(entry.kind, entry.id)));
    const changes = [];
    for (const entry of descriptors) {
      const record = records.get(entry.type === "media" ? mediaKey(entry.id) : itemKey(entry.kind, entry.id));
      if (!record || Number(record.version) !== Number(entry.version)) continue;
      if (entry.type === "media") {
        changes.push({
          kind: "media",
          id: record.id,
          deleted: Boolean(record.deleted),
          payload: record.deleted ? null : {
            id: record.id,
            name: record.name,
            mime: record.mime,
            size: Number(record.size),
            deckIds: Array.isArray(record.deck_ids) ? record.deck_ids : [],
            updatedAt: new Date(Number(record.client_modified_at)).toISOString()
          },
          version: Number(record.version),
          modifiedAt: Number(record.client_modified_at)
        });
      } else {
        let payload = null;
        try { payload = record.payload ? JSON.parse(record.payload) : null; }
        catch (_) { payload = null; }
        changes.push({
          kind: record.kind,
          id: record.id,
          deleted: Boolean(record.deleted),
          payload,
          version: Number(record.version),
          modifiedAt: Number(record.client_modified_at)
        });
      }
    }
    changes.sort((a, b) => a.version - b.version);
    const nextVersion = descriptors.length
      ? Math.max(...descriptors.map((entry) => Number(entry.version) || since))
      : currentVersion;
    return json({
      changes,
      nextVersion,
      currentVersion,
      hasMore: nextVersion < currentVersion,
      isSourceDevice: Boolean(session?.isSourceDevice)
    });
  }

  async downloadMedia(id) {
    const media = await this.get(mediaKey(id));
    if (!media?.complete || media.deleted) return json({ error: "Imagem ainda não disponível." }, 404);
    const keys = [];
    for (let index = 0; index < Number(media.total_chunks); index += 1) keys.push(mediaChunkKey(id, index));
    const stored = await this.getMany(keys);
    const chunks = keys.map((key) => stored.get(key)).filter(Boolean);
    if (chunks.length !== keys.length) return json({ error: "Imagem ainda não disponível." }, 404);
    return new Response(new Blob(chunks, { type: media.mime }), {
      headers: {
        "Content-Type": media.mime,
        "Content-Length": String(media.size),
        "Cache-Control": "private, max-age=31536000, immutable",
        "X-Oitu-Name": encodeURIComponent(media.name)
      }
    });
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/api/sync/password-info" && request.method === "GET") return this.passwordInfo();
    if (url.pathname === "/api/sync/session" && request.method === "POST") return this.createSession(request);

    const session = await this.authenticate(request);
    if (!session) return json({ error: "Sessão expirada. Conecte o perfil novamente." }, 401);
    if (url.pathname === "/api/sync/session" && request.method === "DELETE") {
      await this.remove(sessionKey(session.tokenHash));
      return json({ success: true });
    }
    if (url.pathname === "/api/sync/push" && request.method === "POST") return this.push(request, session);
    if (url.pathname === "/api/sync/pull" && request.method === "GET") return this.pull(url, session);
    if (url.pathname === "/api/sync/media/push" && request.method === "POST") return this.pushMedia(request, session);
    const mediaMatch = url.pathname.match(/^\/api\/sync\/media\/([^/]+)$/);
    if (mediaMatch && request.method === "GET") return this.downloadMedia(decodeURIComponent(mediaMatch[1]));
    return json({ error: "Rota não encontrada." }, 404);
  }
}
