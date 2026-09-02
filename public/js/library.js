(function () {
const state = {
expandedFolders: new Set(),
selected: new Set(),
editingDeckId: null,
createParentFolderId: null,
addExistingTargetFolderId: null,
addExistingExpanded: new Set(),
rendering: false,
renderSeq: 0,
snapshot: null,
summaryHydrationToken: 0,
rerenderRequested: false
};
const $ = (selector) => document.querySelector(selector);
let observer = null;
let renderTimer = null;
let pendingMove = null;
function ensureStyles() {
if (document.querySelector('link[data-oitucards-library-css]')) return;
const link = document.createElement("link");
link.rel = "stylesheet";
link.href = "css/library.css?v=20260823-1115";
link.dataset.oitucardsLibraryCss = "true";
document.head.appendChild(link);
}
function escapeHtml(value) {
return String(value ?? "")
.replaceAll("&", "&amp;")
.replaceAll("<", "&lt;")
.replaceAll(">", "&gt;")
.replaceAll('"', "&quot;")
.replaceAll("'", "&#039;");
}
function showToast(message) {
const toast = $("#toast");
if (!toast) return;
toast.textContent = message;
toast.classList.remove("hidden");
clearTimeout(showToast.timer);
showToast.timer = setTimeout(() => toast.classList.add("hidden"), 2600);
}
function isNewCard(card) {
const count = Number.isInteger(card?.reviewCount)
? card.reviewCount
: (card?.lastReviewedAt || card?.nextReviewAt || card?.lastRating ? 1 : 0);
return count === 0 && !card?.lastReviewedAt && !card?.nextReviewAt && !card?.lastRating;
}
function isDue(card) {
if (isNewCard(card)) return false;
if (!card?.nextReviewAt) return true;
const due = new Date(card.nextReviewAt);
const end = new Date();
end.setHours(23, 59, 59, 999);
return Number.isNaN(due.getTime()) || due <= end;
}
function selectedKey(type, id) { return `${type}:${id}`; }
function isSelected(type, id) { return state.selected.has(selectedKey(type, id)); }
function ensureUI() {
ensureStyles();
const home = $("#homeView");
const heading = home?.querySelector(".page-heading");
const actions = heading?.querySelector(".heading-actions");
if (!home || !heading || !actions) return false;
const eyebrow = heading.querySelector(".eyebrow");
const title = heading.querySelector("h1");
const subtitle = heading.querySelector(".subtitle");
if (eyebrow) eyebrow.textContent = "Biblioteca";
if (title) title.textContent = "Meus baralhos";
if (subtitle) subtitle.textContent = "Organize seus baralhos em pastas e estude do seu jeito.";
$("#libraryBreadcrumb")?.remove();
$("#studyFolderButton")?.remove();
$("#addExistingDecksButton")?.remove();
if (!$("#librarySelectionBar")) {
const bar = document.createElement("div");
bar.id = "librarySelectionBar";
bar.className = "library-selection-bar hidden";
bar.innerHTML = `<span id="librarySelectionCount" class="library-selection-count">0 selecionados</span>
<button id="studySelectedButton" class="button primary" type="button">Estudar selecionados</button>
<button id="deleteSelectedButton" class="button danger" type="button">Excluir selecionados</button>
<button id="moveSelectedButton" class="button ghost" type="button">Mover</button>
<button id="clearSelectionButton" class="button ghost" type="button">Limpar seleção</button>`;
$("#deckList")?.before(bar);
} else {
const bar = $("#librarySelectionBar");
const count = $("#librarySelectionCount");
if (count) bar.prepend(count);
["studySelectedButton", "deleteSelectedButton", "moveSelectedButton", "clearSelectionButton"].forEach(id => {
const button = $(`#${id}`);
if (button) bar.appendChild(button);
});
$("#moveSelectedButton")?.classList.remove("secondary");
$("#moveSelectedButton")?.classList.add("ghost");
}
if (!$("#createFolderButton")) {
const button = document.createElement("button");
button.id = "createFolderButton";
button.className = "button secondary";
button.type = "button";
button.textContent = "+ Criar pasta";
actions.prepend(button);
} else {
$("#createFolderButton").textContent = "+ Criar pasta";
$("#createFolderButton").classList.remove("hidden");
}
$("#addDeckButton")?.classList.remove("hidden");
$("#importDeckButton")?.classList.remove("hidden");
if (!$("#moveDeckButton")) {
const deckActions = $("#deckView .heading-actions");
if (deckActions) {
const button = document.createElement("button");
button.id = "moveDeckButton";
button.className = "button ghost move-deck-button";
button.type = "button";
button.textContent = "Mover para pasta";
deckActions.prepend(button);
}
}
ensureModals();
return true;
}
function ensureModals() {
if (!$("#folderModal")) document.body.insertAdjacentHTML("beforeend", `
<div id="folderModal" class="modal-backdrop hidden" role="dialog" aria-modal="true">
<div class="modal small-modal">
<div class="modal-header"><div><p class="eyebrow">Organização</p><h2 id="folderModalTitle">Nova pasta</h2></div><button class="icon-button modal-close" data-library-close="folderModal" type="button">×</button></div>
<form id="folderForm"><label class="field-label" for="folderNameInput">Nome da pasta</label><input id="folderNameInput" class="text-input" maxlength="120" required autocomplete="off"><div class="modal-actions"><button class="button ghost" data-library-close="folderModal" type="button">Cancelar</button><button class="button primary" type="submit">Criar pasta</button></div></form>
</div>
</div>`);
if (!$("#moveLibraryModal")) document.body.insertAdjacentHTML("beforeend", `
<div id="moveLibraryModal" class="modal-backdrop hidden" role="dialog" aria-modal="true">
<div class="modal small-modal">
<div class="modal-header"><div><p class="eyebrow">Organização</p><h2>Mover para</h2></div><button class="icon-button modal-close" data-library-close="moveLibraryModal" type="button">×</button></div>
<p class="subtitle">Escolha a pasta de destino.</p><div id="moveFolderChoices" class="library-modal-list"></div><div class="modal-actions"><button class="button ghost" data-library-close="moveLibraryModal" type="button">Cancelar</button><button id="confirmMoveButton" class="button primary" type="button">Mover</button></div>
</div>
</div>`);
if (!$("#addExistingModal")) document.body.insertAdjacentHTML("beforeend", `
<div id="addExistingModal" class="modal-backdrop hidden" role="dialog" aria-modal="true">
<div class="modal small-modal">
<div class="modal-header"><div><p class="eyebrow">Pasta</p><h2 id="addExistingModalTitle">Adicionar baralhos existentes</h2></div><button class="icon-button modal-close" data-library-close="addExistingModal" type="button">×</button></div>
<p class="subtitle">Abra as pastas abaixo e selecione os baralhos que deseja mover.</p><div id="existingDeckChoices" class="library-modal-list library-tree-picker"></div><div class="modal-actions"><button class="button ghost" data-library-close="addExistingModal" type="button">Cancelar</button><button id="confirmAddExistingButton" class="button primary" type="button">Adicionar à pasta</button></div>
</div>
</div>`);
}
function openModal(id) {
$(`#${id}`)?.classList.remove("hidden");
document.body.style.overflow = "hidden";
}
function closeModal(id) {
$(`#${id}`)?.classList.add("hidden");
if (!document.querySelector(".modal-backdrop:not(.hidden)")) document.body.style.overflow = "";
}
function folderChildrenMap(folders) {
const map = new Map();
folders.forEach(folder => {
const key = folder.parentId || null;
if (!map.has(key)) map.set(key, []);
map.get(key).push(folder);
});
map.forEach(list => list.sort((a, b) => a.name.localeCompare(b.name, "pt-BR")));
return map;
}
function decksByFolderMap(decks) {
const map = new Map();
decks.forEach(deck => {
const key = deck.folderId || null;
if (!map.has(key)) map.set(key, []);
map.get(key).push(deck);
});
map.forEach(list => list.sort((a, b) => a.name.localeCompare(b.name, "pt-BR")));
return map;
}
function descendantFolderIds(folderId, folders) {
const children = folderChildrenMap(folders);
const out = [];
const visit = id => {
for (const child of children.get(id) || []) {
out.push(child.id);
visit(child.id);
}
};
visit(folderId);
return out;
}
function deckIdsForFolder(folderId, folders, decks) {
const ids = new Set([folderId, ...descendantFolderIds(folderId, folders)]);
return decks.filter(deck => ids.has(deck.folderId || null)).map(deck => deck.id);
}
function folderPath(folderId, folders) {
if (!folderId) return [];
const byId = new Map(folders.map(folder => [folder.id, folder]));
const path = [];
const seen = new Set();
let current = byId.get(folderId);
while (current && !seen.has(current.id)) {
seen.add(current.id);
path.unshift(current);
current = current.parentId ? byId.get(current.parentId) : null;
}
return path;
}
async function normalizeAnkiPaths() {
const decks = await OituDB.getDecks();
const targets = decks.filter(deck => String(deck.name).includes("::"));
if (!targets.length) return false;
let folders = await OituDB.getFolders();
for (const deck of targets) {
const parts = String(deck.name).split("::").map(part => part.trim()).filter(Boolean);
if (parts.length < 2) continue;
const leaf = parts.pop();
let parentId = deck.folderId || null;
for (const part of parts) {
let folder = folders.find(item => (item.parentId || null) === parentId && item.name.toLocaleLowerCase() === part.toLocaleLowerCase());
if (!folder) {
folder = await OituDB.addFolder(part, parentId);
folders.push(folder);
}
parentId = folder.id;
}
await OituDB.updateDeck(deck.id, { name: leaf, folderId: parentId });
}
return true;
}
function todayKey() {
const now = new Date();
return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
function summaryFromDeck(deck) {
const cardCount = Number(deck.cardCount);
const studiedCount = Number(deck.studiedCount);
const dueCount = Number(deck.dueCount);
if (!Number.isInteger(cardCount) || cardCount < 0 || !Number.isInteger(studiedCount) || studiedCount < 0 || deck.summaryDate !== todayKey()) return null;
return {
cardCount,
progress: cardCount ? Math.round((Math.min(studiedCount, cardCount) / cardCount) * 100) : 0,
due: Number.isInteger(dueCount) && dueCount >= 0 ? dueCount : 0
};
}
function buildFolderSummaries(folders, decks, deckSummaries) {
const folderSummaries = new Map();
for (const folder of folders) {
const ids = deckIdsForFolder(folder.id, folders, decks);
let cardCount = 0;
let due = 0;
let pending = false;
ids.forEach(id => {
const summary = deckSummaries.get(id);
if (!summary || summary.pending) { pending = true; return; }
cardCount += summary.cardCount;
due += summary.due;
});
folderSummaries.set(folder.id, { deckCount: ids.length, cardCount, due, pending });
}
return folderSummaries;
}
function buildSummaries(folders, decks) {
const deckSummaries = new Map();
const missingDeckIds = [];
decks.forEach(deck => {
const summary = summaryFromDeck(deck);
if (summary) deckSummaries.set(deck.id, summary);
else {
deckSummaries.set(deck.id, { cardCount: 0, progress: 0, due: 0, pending: true });
missingDeckIds.push(deck.id);
}
});
return { deckSummaries, folderSummaries: buildFolderSummaries(folders, decks, deckSummaries), missingDeckIds };
}
function updateSelectionBar() {
const count = state.selected.size;
$("#librarySelectionBar")?.classList.toggle("hidden", count === 0);
if ($("#librarySelectionCount")) {
$("#librarySelectionCount").textContent = `${count} ${count === 1 ? "item selecionado" : "itens selecionados"}`;
}
}
function setObserver(active) {
const list = $("#deckList");
if (!list || !observer) return;
observer.disconnect();
if (active) observer.observe(list, { childList: true, subtree: false });
}
function renderDeckRow(deck, summary, depth) {
const selected = isSelected("deck", deck.id);
const due = summary?.due || 0;
const cardCount = summary?.cardCount || 0;
const progress = summary?.progress || 0;
return `<article class="deck-row library-tree-row library-deck-row ${selected ? "is-selected" : ""}" data-deck-id="${deck.id}" style="--tree-depth:${depth}">
<div class="library-tree-indent" aria-hidden="true"></div>
<div class="library-select"><input type="checkbox" data-select-deck="${deck.id}" ${selected ? "checked" : ""} aria-label="Selecionar baralho ${escapeHtml(deck.name)}"></div>
<div class="deck-main"><button class="deck-name-button" type="button" data-action="edit-deck">${escapeHtml(deck.name)}</button><div class="deck-info"><span>${summary?.pending ? "… cards" : `${cardCount} ${cardCount === 1 ? "card" : "cards"}`}</span><span>Progresso: ${progress}%</span><span class="review-due-badge ${due ? "has-due" : ""}">↻ ${due} ${due === 1 ? "revisão" : "revisões"} hoje</span></div><div class="progress-track" aria-label="Progresso de ${progress}%"><div class="progress-bar" style="width:${progress}%"></div></div></div>
<div class="deck-actions"><button class="action-button icon-only" type="button" data-action="edit-deck" title="Editar baralho" aria-label="Editar baralho">✎</button><button class="action-button icon-only delete" type="button" data-action="delete-deck" title="Apagar baralho" aria-label="Apagar baralho">🗑</button></div>
</article>`;
}
function renderFolderRow(folder, summary, depth, hasChildren) {
const selected = isSelected("folder", folder.id);
const expanded = state.expandedFolders.has(folder.id);
const due = summary?.due || 0;
return `<article class="deck-row folder-row library-tree-row ${selected ? "is-selected" : ""} ${expanded ? "is-expanded" : ""}" data-folder-id="${folder.id}" style="--tree-depth:${depth}">
<div class="library-tree-indent" aria-hidden="true"></div>
<div class="library-select"><input type="checkbox" data-select-folder="${folder.id}" ${selected ? "checked" : ""} aria-label="Selecionar pasta ${escapeHtml(folder.name)}"></div>
<div class="deck-main folder-main"><button class="folder-toggle-button" type="button" data-toggle-folder="${folder.id}" aria-expanded="${expanded}"><span class="folder-chevron">${expanded ? "▾" : "▸"}</span><span class="folder-icon">📁</span><span class="folder-name-text">${escapeHtml(folder.name)}</span></button><div class="folder-info"><span>${summary?.deckCount || 0} ${summary?.deckCount === 1 ? "baralho" : "baralhos"}</span><span>${summary?.pending ? "… cards" : `${summary?.cardCount || 0} ${summary?.cardCount === 1 ? "card" : "cards"}`}</span>${due ? `<span class="folder-review-due">↻ ${due} ${due === 1 ? "revisão" : "revisões"} hoje</span>` : ""}${!hasChildren ? `<span class="folder-empty-hint">vazia</span>` : ""}</div></div>
<div class="deck-actions folder-row-actions"><button class="action-button icon-only" type="button" data-add-existing-folder="${folder.id}" title="Adicionar baralhos existentes" aria-label="Adicionar baralhos existentes">＋</button><button class="action-button icon-only" type="button" data-create-subfolder="${folder.id}" title="Criar subpasta" aria-label="Criar subpasta">▣</button><button class="action-button icon-only folder-study-button" type="button" data-study-folder="${folder.id}" title="Estudar pasta" aria-label="Estudar pasta">▶</button></div>
</article>`;
}
function renderTree(folders, decks, deckSummaries, folderSummaries) {
const folderChildren = folderChildrenMap(folders);
const deckChildren = decksByFolderMap(decks);
const rows = [];
const renderLevel = (parentId, depth) => {
for (const folder of folderChildren.get(parentId) || []) {
const hasChildren = (folderChildren.get(folder.id)?.length || 0) + (deckChildren.get(folder.id)?.length || 0) > 0;
rows.push(renderFolderRow(folder, folderSummaries.get(folder.id), depth, hasChildren));
if (state.expandedFolders.has(folder.id)) renderLevel(folder.id, depth + 1);
}
for (const deck of deckChildren.get(parentId) || []) {
rows.push(renderDeckRow(deck, deckSummaries.get(deck.id), depth));
}
};
renderLevel(null, 0);
return rows.join("");
}
function renderSnapshot() {
const snapshot = state.snapshot;
if (!snapshot || !$("#homeView")?.classList.contains("active")) return false;
setObserver(false);
$("#deckList").innerHTML = renderTree(snapshot.folders, snapshot.decks, snapshot.deckSummaries, snapshot.folderSummaries) || `<div class="library-empty">Você ainda não possui pastas ou baralhos.</div>`;
setObserver(true);
$("#emptyState")?.classList.add("hidden");
updateSelectionBar();
return true;
}
function scheduleSummaryHydration(missingDeckIds, renderSeq) {
const token = ++state.summaryHydrationToken;
if (!missingDeckIds.length) return;
const run = async () => {
for (const deckId of missingDeckIds) {
if (token !== state.summaryHydrationToken || renderSeq !== state.renderSeq) return;
try {
const cards = await OituDB.getCardsByDeck(deckId);
const studied = cards.filter(card => card.reviewStatus).length;
const summary = {
cardCount: cards.length,
progress: cards.length ? Math.round((studied / cards.length) * 100) : 0,
due: cards.filter(isDue).length
};
state.snapshot?.deckSummaries.set(deckId, summary);
OituDB.updateDeckSummary?.(deckId, {
cardCount: summary.cardCount,
studiedCount: studied,
dueCount: summary.due,
summaryDate: todayKey()
}).catch(() => {});
} catch (error) {
console.warn("OituCards: não foi possível atualizar o resumo de um baralho.", error);
}
await new Promise(resolve => setTimeout(resolve, 0));
}
if (token !== state.summaryHydrationToken || renderSeq !== state.renderSeq || !state.snapshot) return;
state.snapshot.folderSummaries = buildFolderSummaries(state.snapshot.folders, state.snapshot.decks, state.snapshot.deckSummaries);
renderSnapshot();
};
if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(() => run(), { timeout: 1200 });
else setTimeout(run, 80);
}
async function renderLibrary() {
if (!$("#homeView")?.classList.contains("active")) return;
if (state.rendering) { state.rerenderRequested = true; return; }
const seq = ++state.renderSeq;
state.rendering = true;
try {
await normalizeAnkiPaths();
const [folders, decks] = await Promise.all([OituDB.getFolders(), OituDB.getDecks()]);
if (seq !== state.renderSeq) return;
const validFolderIds = new Set(folders.map(folder => folder.id));
[...state.expandedFolders].forEach(id => { if (!validFolderIds.has(id)) state.expandedFolders.delete(id); });
const { deckSummaries, folderSummaries, missingDeckIds } = buildSummaries(folders, decks);
if (seq !== state.renderSeq) return;
state.snapshot = { folders, decks, deckSummaries, folderSummaries };
renderSnapshot();
scheduleSummaryHydration(missingDeckIds, seq);
} finally {
state.rendering = false;
if (state.rerenderRequested) {
state.rerenderRequested = false;
scheduleRender();
}
}
}
function scheduleRender(delay = 0) {
clearTimeout(renderTimer);
renderTimer = setTimeout(() => renderLibrary(), delay);
}
function removeItemsInstantly(deckIds = [], folderIds = []) {
clearTimeout(renderTimer);
renderTimer = null;
const deckIdSet = new Set(deckIds || []);
const folderIdSet = new Set(folderIds || []);
if (state.snapshot) {
state.snapshot.decks = state.snapshot.decks.filter(deck => !deckIdSet.has(deck.id));
state.snapshot.folders = state.snapshot.folders.filter(folder => !folderIdSet.has(folder.id));
deckIdSet.forEach(id => state.snapshot.deckSummaries.delete(id));
folderIdSet.forEach(id => state.expandedFolders.delete(id));
state.snapshot.folderSummaries = buildFolderSummaries(state.snapshot.folders, state.snapshot.decks, state.snapshot.deckSummaries);
}
deckIdSet.forEach(id => state.selected.delete(selectedKey("deck", id)));
folderIdSet.forEach(id => state.selected.delete(selectedKey("folder", id)));
if (state.snapshot && $("#homeView")?.classList.contains("active")) {
renderSnapshot();
return;
}
deckIdSet.forEach(id => document.querySelector(`[data-deck-id="${CSS.escape(id)}"]`)?.remove());
folderIdSet.forEach(id => document.querySelector(`[data-folder-id="${CSS.escape(id)}"]`)?.remove());
updateSelectionBar();
}
function toggleFolder(folderId) {
if (state.expandedFolders.has(folderId)) state.expandedFolders.delete(folderId);
else state.expandedFolders.add(folderId);
renderSnapshot();
}
function openCreateFolder(parentId = null) {
state.createParentFolderId = parentId || null;
$("#folderModalTitle").textContent = parentId ? "Nova subpasta" : "Nova pasta";
$("#folderNameInput").value = "";
openModal("folderModal");
setTimeout(() => $("#folderNameInput")?.focus(), 40);
}
async function createFolder(event) {
event.preventDefault();
const name = $("#folderNameInput").value.trim();
if (!name) return;
const folders = await OituDB.getFolders();
const parentId = state.createParentFolderId || null;
const duplicate = folders.some(folder => (folder.parentId || null) === parentId && folder.name.toLocaleLowerCase() === name.toLocaleLowerCase());
if (duplicate) {
alert("Já existe uma pasta com esse nome neste local.");
return;
}
const folder = await OituDB.addFolder(name, parentId);
if (parentId) state.expandedFolders.add(parentId);
state.expandedFolders.add(folder.id);
state.createParentFolderId = null;
closeModal("folderModal");
showToast(parentId ? "Subpasta criada." : "Pasta criada.");
scheduleRender();
}
async function selectedEntities() {
const [folders, decks] = await Promise.all([OituDB.getFolders(), OituDB.getDecks()]);
const selectedDeckIds = new Set();
const selectedFolderIds = new Set();
for (const key of state.selected) {
const [type, id] = key.split(":");
if (type === "deck") selectedDeckIds.add(id);
if (type === "folder") selectedFolderIds.add(id);
}
return { folders, decks, selectedDeckIds, selectedFolderIds };
}
async function resolveSelectedDeckIds() {
const { folders, decks, selectedDeckIds, selectedFolderIds } = await selectedEntities();
for (const folderId of selectedFolderIds) {
deckIdsForFolder(folderId, folders, decks).forEach(id => selectedDeckIds.add(id));
}
return [...selectedDeckIds];
}
async function studyDeckIds(deckIds, label) {
if (!deckIds.length) {
alert("Nenhum baralho com flashcards foi encontrado nesta seleção.");
return;
}
if (!window.OituMultiStudy?.openConfig) {
alert("O módulo de estudo combinado ainda não terminou de carregar. Tente novamente.");
return;
}
await window.OituMultiStudy.openConfig(deckIds, label);
}
async function studySelected() {
const ids = await resolveSelectedDeckIds();
await studyDeckIds(ids, "Estudar selecionados");
}
async function studyFolder(folderId) {
const folders = state.snapshot?.folders || await OituDB.getFolders();
const decks = state.snapshot?.decks || await OituDB.getDecks();
const folder = folders.find(item => item.id === folderId);
if (!folder) return;
await studyDeckIds(deckIdsForFolder(folderId, folders, decks), folder.name);
}
async function deleteSelected() {
const { folders, decks, selectedDeckIds, selectedFolderIds } = await selectedEntities();
const folderDeleteIds = new Set();
for (const id of selectedFolderIds) {
folderDeleteIds.add(id);
descendantFolderIds(id, folders).forEach(child => folderDeleteIds.add(child));
deckIdsForFolder(id, folders, decks).forEach(deckId => selectedDeckIds.add(deckId));
}
const message = `Excluir ${selectedDeckIds.size} ${selectedDeckIds.size === 1 ? "baralho" : "baralhos"}${folderDeleteIds.size ? ` e ${folderDeleteIds.size} ${folderDeleteIds.size === 1 ? "pasta" : "pastas"}` : ""}? Todos os flashcards contidos serão apagados deste navegador.`;
if (!window.confirm(message)) return;
const deckIds = [...selectedDeckIds];
const folderIds = [...folderDeleteIds];
removeItemsInstantly(deckIds, folderIds);
state.selected.clear();
window.OituActionFeedback?.setLoading?.(true, "Excluindo itens selecionados");
try {
if (typeof OituDB.deleteLibraryItems === "function") await OituDB.deleteLibraryItems(deckIds, folderIds);
else {
for (const deckId of deckIds) await OituDB.deleteDeck(deckId);
const depth = id => folderPath(id, folders).length;
for (const folderId of folderIds.sort((a, b) => depth(b) - depth(a))) await OituDB.deleteFolder(folderId);
}
window.OituActionFeedback?.setLoading?.(false);
showToast("Itens excluídos.");
scheduleRender();
} catch (error) {
window.OituActionFeedback?.setLoading?.(false);
console.error("OituCards: falha ao excluir itens selecionados.", error);
alert("Não foi possível concluir a exclusão. Tente novamente.");
await renderLibrary();
} finally {
window.OituActionFeedback?.setLoading?.(false);
}
}
async function openMoveModal(entities = null) {
const folders = await OituDB.getFolders();
pendingMove = entities || await selectedEntities();
const folderIds = pendingMove.selectedFolderIds || new Set();
const invalid = new Set();
for (const id of folderIds) {
invalid.add(id);
descendantFolderIds(id, folders).forEach(child => invalid.add(child));
}
const choices = [
{ id: "", name: "Sem pasta (raiz)", path: "Biblioteca" },
...folders.filter(folder => !invalid.has(folder.id)).map(folder => ({
id: folder.id,
name: folder.name,
path: folderPath(folder.id, folders).map(item => item.name).join(" › ")
}))
];
$("#moveFolderChoices").innerHTML = choices.map((choice, index) => `<label class="library-choice"><input type="radio" name="moveTargetFolder" value="${choice.id}" ${index === 0 ? "checked" : ""}><span><strong>${escapeHtml(choice.name)}</strong><small>${escapeHtml(choice.path)}</small></span></label>`).join("");
openModal("moveLibraryModal");
}
async function confirmMove() {
if (!pendingMove) return;
const target = document.querySelector('input[name="moveTargetFolder"]:checked')?.value || null;
for (const deckId of pendingMove.selectedDeckIds || []) await OituDB.updateDeck(deckId, { folderId: target || null });
for (const folderId of pendingMove.selectedFolderIds || []) await OituDB.updateFolder(folderId, { parentId: target || null });
if (target) state.expandedFolders.add(target);
closeModal("moveLibraryModal");
pendingMove = null;
state.selected.clear();
showToast("Itens movidos.");
scheduleRender();
}
async function openMoveCurrentDeck() {
if (!state.editingDeckId) {
alert("Abra um baralho pela opção de edição antes de movê-lo.");
return;
}
const deck = await OituDB.getDeck(state.editingDeckId);
if (!deck) return;
await openMoveModal({ selectedDeckIds: new Set([deck.id]), selectedFolderIds: new Set() });
}
function renderExistingPicker(folders, decks) {
const folderChildren = folderChildrenMap(folders);
const deckChildren = decksByFolderMap(decks);
const rows = [];
const target = state.addExistingTargetFolderId;
const renderDeckChoice = (deck, depth) => {
const alreadyThere = (deck.folderId || null) === target;
rows.push(`<label class="library-choice library-picker-deck ${alreadyThere ? "is-disabled" : ""}" style="--picker-depth:${depth}"><span class="picker-indent" aria-hidden="true"></span><input type="checkbox" data-existing-deck="${deck.id}" ${alreadyThere ? "disabled" : ""}><span><strong>${escapeHtml(deck.name)}</strong><small>${alreadyThere ? "Já está nesta pasta" : "Selecionar para mover"}</small></span></label>`);
};
const renderFolderChoice = (folder, depth) => {
const expanded = state.addExistingExpanded.has(folder.id);
rows.push(`<button class="library-picker-folder" type="button" data-add-picker-folder="${folder.id}" style="--picker-depth:${depth}" aria-expanded="${expanded}"><span class="picker-indent" aria-hidden="true"></span><span class="folder-chevron">${expanded ? "▾" : "▸"}</span><span class="folder-icon">📁</span><span>${escapeHtml(folder.name)}</span></button>`);
if (!expanded) return;
for (const child of folderChildren.get(folder.id) || []) renderFolderChoice(child, depth + 1);
for (const deck of deckChildren.get(folder.id) || []) renderDeckChoice(deck, depth + 1);
};
rows.push(`<button class="library-picker-folder library-picker-root" type="button" data-add-picker-root aria-expanded="true"><span class="folder-chevron">▾</span><span class="folder-icon">📚</span><span>Sem pasta</span></button>`);
for (const deck of deckChildren.get(null) || []) renderDeckChoice(deck, 1);
for (const folder of folderChildren.get(null) || []) renderFolderChoice(folder, 0);
return rows.join("");
}
async function refreshAddExistingPicker() {
const [decks, folders] = await Promise.all([OituDB.getDecks(), OituDB.getFolders()]);
$("#existingDeckChoices").innerHTML = renderExistingPicker(folders, decks) || `<div class="library-empty">Nenhum baralho disponível.</div>`;
}
async function openAddExisting(folderId) {
const folder = await OituDB.getFolder(folderId);
if (!folder) return;
state.addExistingTargetFolderId = folderId;
state.addExistingExpanded = new Set(folderPath(folderId, await OituDB.getFolders()).map(item => item.id));
$("#addExistingModalTitle").textContent = `Adicionar baralhos a ${folder.name}`;
await refreshAddExistingPicker();
openModal("addExistingModal");
}
async function confirmAddExisting() {
const target = state.addExistingTargetFolderId;
if (!target) return;
const ids = [...document.querySelectorAll("[data-existing-deck]:checked")].map(element => element.dataset.existingDeck);
if (!ids.length) {
closeModal("addExistingModal");
return;
}
for (const id of ids) await OituDB.updateDeck(id, { folderId: target });
state.expandedFolders.add(target);
closeModal("addExistingModal");
showToast(`${ids.length} ${ids.length === 1 ? "baralho adicionado" : "baralhos adicionados"} à pasta.`);
scheduleRender();
}
function toggleSelection(type, id, checked) {
const key = selectedKey(type, id);
if (checked) state.selected.add(key);
else state.selected.delete(key);
updateSelectionBar();
const row = type === "deck"
? document.querySelector(`[data-deck-id="${CSS.escape(id)}"]`)
: document.querySelector(`[data-folder-id="${CSS.escape(id)}"]`);
row?.classList.toggle("is-selected", checked);
}
function bindEvents() {
$("#createFolderButton").addEventListener("click", () => openCreateFolder(null));
$("#folderForm").addEventListener("submit", createFolder);
$("#studySelectedButton").addEventListener("click", studySelected);
$("#deleteSelectedButton").addEventListener("click", deleteSelected);
$("#moveSelectedButton").addEventListener("click", () => openMoveModal());
$("#clearSelectionButton").addEventListener("click", () => {
state.selected.clear();
scheduleRender();
});
$("#confirmAddExistingButton").addEventListener("click", confirmAddExisting);
$("#confirmMoveButton").addEventListener("click", confirmMove);
$("#moveDeckButton").addEventListener("click", openMoveCurrentDeck);
document.addEventListener("change", event => {
const deck = event.target.closest("[data-select-deck]");
const folder = event.target.closest("[data-select-folder]");
if (deck) toggleSelection("deck", deck.dataset.selectDeck, deck.checked);
if (folder) toggleSelection("folder", folder.dataset.selectFolder, folder.checked);
});
document.addEventListener("click", event => {
const toggle = event.target.closest("[data-toggle-folder]");
const study = event.target.closest("[data-study-folder]");
const subfolder = event.target.closest("[data-create-subfolder]");
const addExisting = event.target.closest("[data-add-existing-folder]");
const pickerFolder = event.target.closest("[data-add-picker-folder]");
const close = event.target.closest("[data-library-close]");
if (toggle) {
event.preventDefault();
event.stopPropagation();
toggleFolder(toggle.dataset.toggleFolder);
return;
}
if (study) {
event.preventDefault();
event.stopPropagation();
studyFolder(study.dataset.studyFolder);
return;
}
if (subfolder) {
event.preventDefault();
event.stopPropagation();
openCreateFolder(subfolder.dataset.createSubfolder);
return;
}
if (addExisting) {
event.preventDefault();
event.stopPropagation();
openAddExisting(addExisting.dataset.addExistingFolder);
return;
}
if (pickerFolder) {
const id = pickerFolder.dataset.addPickerFolder;
if (state.addExistingExpanded.has(id)) state.addExistingExpanded.delete(id);
else state.addExistingExpanded.add(id);
refreshAddExistingPicker();
return;
}
if (close) {
closeModal(close.dataset.libraryClose);
return;
}
});
document.addEventListener("click", event => {
const edit = event.target.closest('[data-action="edit-deck"]');
const row = edit?.closest("[data-deck-id]");
if (edit && row && !edit.classList.contains("deck-name-button")) {
state.editingDeckId = row.dataset.deckId;
}
}, true);
$("#homeButton")?.addEventListener("click", () => {
state.selected.clear();
scheduleRender(30);
}, true);
$("#backHomeButton")?.addEventListener("click", () => scheduleRender(30), true);
$("#importDeckButton")?.addEventListener("click", () => scheduleRender(1200));
document.querySelectorAll("#folderModal,#moveLibraryModal,#addExistingModal").forEach(backdrop => {
backdrop.addEventListener("mousedown", event => {
if (event.target === backdrop) closeModal(backdrop.id);
});
});
}
function initObserver() {
observer = new MutationObserver(() => {
if (!state.rendering && $("#homeView")?.classList.contains("active")) scheduleRender(15);
});
setObserver(true);
}
function init() {
if (!ensureUI()) return;
bindEvents();
initObserver();
scheduleRender(30);
}
window.OituLibrary = {
render: renderLibrary,
studyFolder,
normalizeAnkiPaths,
toggleFolder,
removeItemsInstantly
};
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
else init();
})();
