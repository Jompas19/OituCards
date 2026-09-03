const SESSION_DAYS = 90;
const MAX_PUSH_BYTES = 5 * 1024 * 1024;
const MAX_MEDIA_PUSH_BYTES = 9 * 1024 * 1024;
const MAX_ITEM_BYTES = 1_700_000;
const MAX_MEDIA_BYTES = 64 * 1024 * 1024;
const PASSWORD_ITERATIONS = 120000;
const PASSWORD_PROOF_SCHEME = "client-pbkdf2-v1";

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
    difference |= (a.charCodeAt(index % Math.max(1, a.length)) || 0) ^ (b.charCodeAt(index % Math.max(1, b.length)) || 0);
  }
  return difference === 0;
}

function first(cursor) {
  for (const row of cursor) return row;
  return null;
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

export class OituSyncUser {
  constructor(ctx) {
    this.ctx = ctx;
    this.sql = ctx.storage.sql;
    this.ensureSchema();
  }

  ensureSchema() {
    this.sql.exec(`CREATE TABLE IF NOT EXISTS profile (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      username TEXT NOT NULL,
      password_hash TEXT,
      password_salt TEXT,
      seq INTEGER NOT NULL DEFAULT 0,
      failed_attempts INTEGER NOT NULL DEFAULT 0,
      locked_until INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS sync_meta (
      name TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      device_id TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS items (
      kind TEXT NOT NULL,
      id TEXT NOT NULL,
      parent_id TEXT,
      payload TEXT,
      deleted INTEGER NOT NULL DEFAULT 0,
      version INTEGER NOT NULL,
      client_modified_at INTEGER NOT NULL,
      device_id TEXT NOT NULL,
      PRIMARY KEY (kind, id)
    )`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS media (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      mime TEXT NOT NULL,
      size INTEGER NOT NULL,
      deck_ids TEXT NOT NULL,
      upload_id TEXT,
      total_chunks INTEGER NOT NULL DEFAULT 0,
      complete INTEGER NOT NULL DEFAULT 0,
      deleted INTEGER NOT NULL DEFAULT 0,
      version INTEGER NOT NULL DEFAULT 0,
      client_modified_at INTEGER NOT NULL,
      device_id TEXT NOT NULL
    )`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS media_chunks (
      media_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      data BLOB NOT NULL,
      PRIMARY KEY (media_id, chunk_index)
    )`);
    this.sql.exec("CREATE INDEX IF NOT EXISTS idx_items_version ON items(version)");
    this.sql.exec("CREATE INDEX IF NOT EXISTS idx_items_parent ON items(kind, parent_id)");
    this.sql.exec("CREATE INDEX IF NOT EXISTS idx_media_version ON media(version)");
  }

  atomic(callback) {
    if (typeof this.ctx.storage.transactionSync === "function") {
      return this.ctx.storage.transactionSync(callback);
    }
    return callback();
  }

  profile() {
    return first(this.sql.exec("SELECT * FROM profile WHERE singleton = 1"));
  }

  sourceDeviceId() {
    return first(this.sql.exec("SELECT value FROM sync_meta WHERE name = 'source_device_id'"))?.value || null;
  }

  rememberSourceDevice(deviceId) {
    if (!validIdentifier(deviceId)) return this.sourceDeviceId();
    this.sql.exec(
      "INSERT OR IGNORE INTO sync_meta(name, value) VALUES('source_device_id', ?)",
      deviceId
    );
    return this.sourceDeviceId();
  }

  resolveSourceDevice(fallbackDeviceId) {
    const existing = this.sourceDeviceId();
    if (existing) return existing;
    const origin = first(this.sql.exec("SELECT device_id FROM items ORDER BY version LIMIT 1"));
    return this.rememberSourceDevice(origin?.device_id || fallbackDeviceId);
  }

  passwordInfo() {
    const profile = this.profile();
    const legacy = Boolean(profile?.password_hash && profile.password_salt !== PASSWORD_PROOF_SCHEME);
    return json({
      protected: Boolean(profile?.password_hash),
      scheme: legacy ? "legacy-pbkdf2" : PASSWORD_PROOF_SCHEME,
      salt: legacy ? profile.password_salt : null
    });
  }

  async createSession(request) {
    const length = Number(request.headers.get("content-length")) || 0;
    if (length > 8192) return json({ error: "Solicitação inválida." }, 413);
    let body;
    try {
      const raw = await request.text();
      if (new TextEncoder().encode(raw).byteLength > 8192) return json({ error: "Solicitação inválida." }, 413);
      body = JSON.parse(raw);
    }
    catch (_) { return json({ error: "Solicitação inválida." }, 400); }

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
    let profile = this.profile();
    let created = false;
    if (!profile) {
      const protectedProfile = Boolean(password || passwordProof);
      const salt = protectedProfile ? (passwordProof ? PASSWORD_PROOF_SCHEME : randomToken(18)) : null;
      const digest = protectedProfile
        ? (passwordProof ? await sha256(`${PASSWORD_PROOF_SCHEME}:${passwordProof}`) : await passwordDigest(password, salt))
        : null;
      profile = this.profile();
      if (!profile) {
        this.sql.exec(
          "INSERT INTO profile(singleton, username, password_hash, password_salt, seq, created_at, updated_at) VALUES(1, ?, ?, ?, 0, ?, ?)",
          username, digest, salt, now, now
        );
        this.rememberSourceDevice(deviceId);
        profile = this.profile();
        created = true;
      }
    }
    if (!created) {
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
          this.sql.exec(
            "UPDATE profile SET failed_attempts = ?, locked_until = ?, updated_at = ? WHERE singleton = 1",
            attempts, lockMs ? now + lockMs : 0, now
          );
          return json({ error: "Usuário ou senha incorretos." }, attempts >= 5 ? 429 : 403);
        }
        if (profile.password_salt !== PASSWORD_PROOF_SCHEME && passwordProof) {
          const migratedDigest = await sha256(`${PASSWORD_PROOF_SCHEME}:${passwordProof}`);
          this.sql.exec(
            "UPDATE profile SET password_hash = ?, password_salt = ?, updated_at = ? WHERE singleton = 1",
            migratedDigest, PASSWORD_PROOF_SCHEME, now
          );
          profile = this.profile();
        }
      }
      this.sql.exec("UPDATE profile SET failed_attempts = 0, locked_until = 0, updated_at = ? WHERE singleton = 1", now);
      this.resolveSourceDevice(deviceId);
    }

    this.sql.exec("DELETE FROM sessions WHERE expires_at <= ?", now);
    const token = randomToken();
    const tokenHash = await sha256(token);
    const expiresAt = now + SESSION_DAYS * 24 * 60 * 60 * 1000;
    this.sql.exec(
      "INSERT INTO sessions(token_hash, device_id, expires_at, created_at) VALUES(?, ?, ?, ?)",
      tokenHash, deviceId, expiresAt, now
    );
    return json({
      token,
      username,
      created,
      protected: Boolean(profile?.password_hash),
      isSourceDevice: this.resolveSourceDevice(deviceId) === deviceId,
      currentVersion: Number(profile?.seq) || 0,
      expiresAt
    });
  }

  async authenticate(request) {
    const authorization = request.headers.get("authorization") || "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
    if (!token) return null;
    const tokenHash = await sha256(token);
    const session = first(this.sql.exec(
      "SELECT token_hash, device_id, expires_at FROM sessions WHERE token_hash = ?",
      tokenHash
    ));
    if (!session || Number(session.expires_at) <= Date.now()) {
      if (session) this.sql.exec("DELETE FROM sessions WHERE token_hash = ?", tokenHash);
      return null;
    }
    const sourceDeviceId = this.resolveSourceDevice(session.device_id);
    return { ...session, tokenHash, isSourceDevice: sourceDeviceId === session.device_id };
  }

  currentSequence() {
    return Number(this.profile()?.seq) || 0;
  }

  cascadeDeckDelete(deckId, modifiedAt, deviceId, nextVersion) {
    this.sql.exec("DELETE FROM items WHERE kind = 'card' AND parent_id = ?", deckId);
    const rows = [...this.sql.exec("SELECT * FROM media WHERE deleted = 0")];
    for (const row of rows) {
      let deckIds;
      try { deckIds = JSON.parse(row.deck_ids || "[]"); }
      catch (_) { deckIds = []; }
      if (!deckIds.includes(deckId)) continue;
      const remaining = deckIds.filter((id) => id !== deckId);
      if (!remaining.length) {
        this.sql.exec("DELETE FROM media_chunks WHERE media_id = ?", row.id);
        this.sql.exec("DELETE FROM media WHERE id = ?", row.id);
        continue;
      }
      const version = nextVersion();
      this.sql.exec(
        "UPDATE media SET deck_ids = ?, version = ?, client_modified_at = ?, device_id = ? WHERE id = ?",
        JSON.stringify(remaining), version, modifiedAt, deviceId, row.id
      );
    }
  }

  applyMutation(mutation, deviceId, nextVersion) {
    const kind = String(mutation?.kind || "");
    const id = String(mutation?.id || "");
    const operation = mutation?.op === "delete" ? "delete" : "upsert";
    if (!["deck", "folder", "card"].includes(kind) || !validIdentifier(id)) return false;
    const modifiedAt = Math.max(1, Number(mutation.modifiedAt) || Date.now());
    const current = first(this.sql.exec("SELECT * FROM items WHERE kind = ? AND id = ?", kind, id));
    if (!incomingWins(current, modifiedAt, deviceId)) return false;

    if (operation === "upsert") {
      const payload = mutation.payload;
      if (!payload || typeof payload !== "object" || String(payload.id || id) !== id) return false;
      const serialized = JSON.stringify({ ...payload, id });
      if (new TextEncoder().encode(serialized).byteLength > MAX_ITEM_BYTES) return false;
      const parentId = kind === "card" ? String(payload.deckId || "") :
        kind === "deck" ? (payload.folderId ? String(payload.folderId) : null) :
        (payload.parentId ? String(payload.parentId) : null);
      if (kind === "card" && !validIdentifier(parentId)) return false;
      if (kind === "card") {
        const parent = first(this.sql.exec("SELECT deleted, client_modified_at FROM items WHERE kind = 'deck' AND id = ?", parentId));
        if (parent?.deleted && Number(parent.client_modified_at) >= modifiedAt) return false;
      }
      const version = nextVersion();
      this.sql.exec(`INSERT INTO items(kind, id, parent_id, payload, deleted, version, client_modified_at, device_id)
        VALUES(?, ?, ?, ?, 0, ?, ?, ?)
        ON CONFLICT(kind, id) DO UPDATE SET parent_id = excluded.parent_id, payload = excluded.payload,
          deleted = 0, version = excluded.version, client_modified_at = excluded.client_modified_at,
          device_id = excluded.device_id`,
      kind, id, parentId, serialized, version, modifiedAt, deviceId);
      return true;
    }

    const version = nextVersion();
    const parentId = current?.parent_id || null;
    this.sql.exec(`INSERT INTO items(kind, id, parent_id, payload, deleted, version, client_modified_at, device_id)
      VALUES(?, ?, ?, NULL, 1, ?, ?, ?)
      ON CONFLICT(kind, id) DO UPDATE SET payload = NULL, deleted = 1, version = excluded.version,
        client_modified_at = excluded.client_modified_at, device_id = excluded.device_id`,
    kind, id, parentId, version, modifiedAt, deviceId);
    if (kind === "deck") this.cascadeDeckDelete(id, modifiedAt, deviceId, nextVersion);
    return true;
  }

  async push(request, session) {
    const length = Number(request.headers.get("content-length")) || 0;
    if (length > MAX_PUSH_BYTES) return json({ error: "Lote de sincronização muito grande." }, 413);
    let body;
    try {
      const raw = await request.text();
      if (new TextEncoder().encode(raw).byteLength > MAX_PUSH_BYTES) return json({ error: "Lote de sincronização muito grande." }, 413);
      body = JSON.parse(raw);
    }
    catch (_) { return json({ error: "Lote de sincronização inválido." }, 400); }
    const mutations = Array.isArray(body?.mutations) ? body.mutations : [];
    if (!mutations.length || mutations.length > 300) return json({ error: "Lote de sincronização inválido." }, 400);

    let sequence = 0;
    let accepted = 0;
    this.atomic(() => {
      sequence = this.currentSequence();
      const initialSequence = sequence;
      const nextVersion = () => { sequence += 1; return sequence; };
      for (const mutation of mutations) {
        if (this.applyMutation(mutation, session.device_id, nextVersion)) accepted += 1;
      }
      if (sequence !== initialSequence) {
        this.sql.exec("UPDATE profile SET seq = ?, updated_at = ? WHERE singleton = 1", sequence, Date.now());
      }
    });
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
      let valid = true;
      for (const part of parts) {
        const file = form.get(String(part.key || ""));
        const index = Number(part.index);
        if (!file || typeof file.arrayBuffer !== "function" || !Number.isInteger(index) || index < 0 || index >= totalChunks || file.size > 1100000) {
          valid = false;
          break;
        }
        buffers.push({ index, data: await file.arrayBuffer() });
        aggregateBytes += file.size;
        aggregateParts += 1;
        if (aggregateBytes > MAX_MEDIA_PUSH_BYTES || aggregateParts > 16) {
          return json({ error: "Lote de imagens muito grande." }, 413);
        }
      }
      if (!valid || !buffers.length) return json({ error: "Um bloco de imagem é inválido." }, 400);
      prepared.push({ entry, size, totalChunks, buffers });
    }
    if (!prepared.length) return json({ error: "Nenhuma imagem válida foi recebida." }, 400);

    let sequence = 0;
    let completed = 0;
    this.atomic(() => {
      sequence = this.currentSequence();
      for (const item of prepared) {
        const entry = item.entry;
        const modifiedAt = Math.max(1, Number(entry.modifiedAt) || Date.now());
        let current = first(this.sql.exec("SELECT * FROM media WHERE id = ?", entry.id));
        if (current?.upload_id !== entry.uploadId) {
          const restartingOwnIncompleteUpload = current && !current.complete &&
            Number(current.client_modified_at) === modifiedAt && current.device_id === session.device_id;
          if (!restartingOwnIncompleteUpload && !incomingWins(current, modifiedAt, session.device_id)) continue;
          this.sql.exec("DELETE FROM media_chunks WHERE media_id = ?", entry.id);
          const name = String(entry.name || "imagem").slice(0, 255);
          const mime = String(entry.mime || "application/octet-stream").slice(0, 120);
          const deckIds = Array.isArray(entry.deckIds) ? entry.deckIds.filter(validIdentifier).slice(0, 200) : [];
          this.sql.exec(`INSERT INTO media(id, name, mime, size, deck_ids, upload_id, total_chunks, complete, deleted, version, client_modified_at, device_id)
            VALUES(?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?)
            ON CONFLICT(id) DO UPDATE SET name = excluded.name, mime = excluded.mime, size = excluded.size,
              deck_ids = excluded.deck_ids, upload_id = excluded.upload_id, total_chunks = excluded.total_chunks,
              complete = 0, deleted = 0, version = 0, client_modified_at = excluded.client_modified_at,
              device_id = excluded.device_id`,
          entry.id, name, mime, item.size, JSON.stringify(deckIds), entry.uploadId, item.totalChunks, modifiedAt, session.device_id);
        }
        for (const chunk of item.buffers) {
          this.sql.exec(
            "INSERT OR REPLACE INTO media_chunks(media_id, chunk_index, data) VALUES(?, ?, ?)",
            entry.id, chunk.index, chunk.data
          );
        }
        current = first(this.sql.exec("SELECT complete, total_chunks FROM media WHERE id = ?", entry.id));
        const received = Number(first(this.sql.exec("SELECT COUNT(*) AS count FROM media_chunks WHERE media_id = ?", entry.id))?.count) || 0;
        if (!current?.complete && received === Number(current?.total_chunks)) {
          sequence += 1;
          this.sql.exec("UPDATE media SET complete = 1, version = ? WHERE id = ?", sequence, entry.id);
          completed += 1;
        }
      }
      this.sql.exec("UPDATE profile SET seq = ?, updated_at = ? WHERE singleton = 1", sequence, Date.now());
    });
    return json({ completed, currentVersion: sequence });
  }

  pull(url, session) {
    const since = Math.max(0, Number(url.searchParams.get("since")) || 0);
    const limit = Math.max(1, Math.min(500, Number(url.searchParams.get("limit")) || 500));
    const itemRows = [...this.sql.exec(
      "SELECT kind, id, payload, deleted, version, client_modified_at FROM items WHERE version > ? ORDER BY version LIMIT ?",
      since, limit
    )];
    const mediaRows = [...this.sql.exec(
      "SELECT id, name, mime, size, deck_ids, deleted, version, client_modified_at FROM media WHERE version > ? AND (complete = 1 OR deleted = 1) ORDER BY version LIMIT ?",
      since, limit
    )];
    const changes = [
      ...itemRows.map((row) => ({
        kind: row.kind,
        id: row.id,
        deleted: Boolean(row.deleted),
        payload: row.payload ? JSON.parse(row.payload) : null,
        version: Number(row.version),
        modifiedAt: Number(row.client_modified_at)
      })),
      ...mediaRows.map((row) => ({
        kind: "media",
        id: row.id,
        deleted: Boolean(row.deleted),
        payload: row.deleted ? null : {
          id: row.id,
          name: row.name,
          mime: row.mime,
          size: Number(row.size),
          deckIds: JSON.parse(row.deck_ids || "[]"),
          updatedAt: new Date(Number(row.client_modified_at)).toISOString()
        },
        version: Number(row.version),
        modifiedAt: Number(row.client_modified_at)
      }))
    ].sort((a, b) => a.version - b.version).slice(0, limit);
    const currentVersion = this.currentSequence();
    const nextVersion = changes.length ? changes[changes.length - 1].version : since;
    return json({
      changes,
      nextVersion,
      currentVersion,
      hasMore: nextVersion < currentVersion,
      isSourceDevice: Boolean(session?.isSourceDevice)
    });
  }

  downloadMedia(id) {
    const media = first(this.sql.exec(
      "SELECT name, mime, size FROM media WHERE id = ? AND complete = 1 AND deleted = 0",
      id
    ));
    if (!media) return json({ error: "Imagem ainda não disponível." }, 404);
    const chunks = [...this.sql.exec(
      "SELECT data FROM media_chunks WHERE media_id = ? ORDER BY chunk_index",
      id
    )].map((row) => row.data);
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
      this.sql.exec("DELETE FROM sessions WHERE token_hash = ?", session.tokenHash);
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/sync/")) return env.ASSETS.fetch(request);
    if (request.headers.get("origin") && request.headers.get("origin") !== url.origin) {
      return json({ error: "Origem não autorizada." }, 403);
    }

    let username = request.headers.get("x-oitu-user");
    if (username) {
      try { username = decodeURIComponent(username); } catch (_) { username = null; }
    }
    if (url.pathname === "/api/sync/session" && request.method === "POST") {
      const clone = request.clone();
      try { username = (await clone.json())?.username; }
      catch (_) { username = null; }
    }
    username = normalizeUsername(username);
    if (!username) return json({ error: "Usuário inválido." }, 400);

    const id = env.SYNC_USERS.idFromName(username);
    try {
      return await env.SYNC_USERS.get(id).fetch(request);
    } catch (error) {
      console.error("OituCards sync storage failure", error);
      return json({
        error: "O armazenamento da sincronização está temporariamente indisponível. Tente novamente em instantes.",
        code: "SYNC_STORAGE_UNAVAILABLE"
      }, 503);
    }
  }
};
