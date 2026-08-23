(function () {
  const savedRanges = new Map();

  function editorFor(name) {
    return name === "front"
      ? document.getElementById("frontEditor")
      : document.getElementById("backEditor");
  }

  function saveSelection(name) {
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) return;

    const editor = editorFor(name);
    const range = selection.getRangeAt(0);

    if (editor && editor.contains(range.commonAncestorContainer)) {
      savedRanges.set(name, range.cloneRange());
    }
  }

  function restoreSelection(name) {
    const range = savedRanges.get(name);
    const editor = editorFor(name);
    if (!editor) return;

    editor.focus();

    if (!range) return;

    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function applyCommand(name, cmd, value = null) {
    restoreSelection(name);
    document.execCommand("styleWithCSS", false, true);

    if (cmd === "hiliteColor") {
      const success = document.execCommand("hiliteColor", false, value);
      if (!success) document.execCommand("backColor", false, value);
    } else {
      document.execCommand(cmd, false, value);
    }

    saveSelection(name);
  }

  function insertImage(name, dataUrl, altText = "Imagem do flashcard") {
    restoreSelection(name);

    const editor = editorFor(name);
    if (!editor) return;

    const selection = window.getSelection();
    let range;

    if (selection && selection.rangeCount && editor.contains(selection.anchorNode)) {
      range = selection.getRangeAt(0);
    } else {
      range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
    }

    const img = document.createElement("img");
    img.src = dataUrl;
    img.alt = altText;
    img.loading = "lazy";

    range.deleteContents();
    range.insertNode(img);

    const after = document.createRange();
    after.setStartAfter(img);
    after.collapse(true);
    selection.removeAllRanges();
    selection.addRange(after);
    saveSelection(name);
  }

  function sanitizeHtml(html) {
    const template = document.createElement("template");
    template.innerHTML = html;

    const allowedTags = new Set([
      "DIV", "P", "BR", "B", "STRONG", "I", "EM", "U",
      "UL", "OL", "LI", "SPAN", "IMG"
    ]);

    const nodes = Array.from(template.content.querySelectorAll("*"));

    for (const node of nodes) {
      if (!allowedTags.has(node.tagName)) {
        node.replaceWith(...node.childNodes);
        continue;
      }

      const attrs = Array.from(node.attributes);
      for (const attr of attrs) {
        const name = attr.name.toLowerCase();

        if (node.tagName === "IMG" && name === "src") {
          if (!attr.value.startsWith("data:image/")) node.removeAttribute(attr.name);
          continue;
        }

        if (node.tagName === "IMG" && ["alt", "loading"].includes(name)) continue;

        if (name === "style") {
          const allowed = [];
          const style = node.style;
          if (style.color) allowed.push(`color: ${style.color}`);
          if (style.backgroundColor) allowed.push(`background-color: ${style.backgroundColor}`);
          if (style.fontWeight) allowed.push(`font-weight: ${style.fontWeight}`);
          if (style.fontStyle) allowed.push(`font-style: ${style.fontStyle}`);
          if (style.textDecoration) allowed.push(`text-decoration: ${style.textDecoration}`);
          node.setAttribute("style", allowed.join("; "));
          continue;
        }

        node.removeAttribute(attr.name);
      }
    }

    return template.innerHTML.trim();
  }

  function hasContent(editor) {
    const text = (editor.textContent || "").replace(/\u200B/g, "").trim();
    return Boolean(text || editor.querySelector("img"));
  }

  function plainTextFromHtml(html) {
    const template = document.createElement("template");
    template.innerHTML = html;
    const text = (template.content.textContent || "").replace(/\s+/g, " ").trim();
    const hasImage = Boolean(template.content.querySelector("img"));
    if (text) return text;
    if (hasImage) return "[Imagem]";
    return "(Sem texto)";
  }

  function resetEditors() {
    ["front", "back"].forEach((name) => {
      const editor = editorFor(name);
      if (editor) editor.innerHTML = "";
      savedRanges.delete(name);
    });

  }

  function setEditors(frontHtml, backHtml) {
    editorFor("front").innerHTML = frontHtml || "";
    editorFor("back").innerHTML = backHtml || "";
    savedRanges.clear();
  }

  function init() {
    document.querySelectorAll(".toolbar").forEach((toolbar) => {
      const name = toolbar.dataset.toolbarFor;
      const editor = editorFor(name);

      editor.addEventListener("keyup", () => saveSelection(name));
      editor.addEventListener("mouseup", () => saveSelection(name));
      editor.addEventListener("focus", () => saveSelection(name));

      editor.addEventListener("paste", (event) => {
        const items = Array.from(event.clipboardData?.items || []);
        const imageItem = items.find((item) => item.type.startsWith("image/"));

        if (imageItem) {
          event.preventDefault();
          const file = imageItem.getAsFile();
          const reader = new FileReader();
          reader.onload = () => insertImage(name, reader.result, file?.name || "Imagem colada");
          reader.readAsDataURL(file);
          return;
        }

        event.preventDefault();
        const text = event.clipboardData?.getData("text/plain") || "";
        document.execCommand("insertText", false, text);
      });

      toolbar.querySelectorAll("[data-cmd]").forEach((button) => {
        button.addEventListener("mousedown", (event) => {
          event.preventDefault();
          saveSelection(name);
          applyCommand(name, button.dataset.cmd);
        });
      });

      toolbar.querySelectorAll(".color-control").forEach((control) => {
        const toggle = control.querySelector(".color-toggle");
        const palette = control.querySelector(".color-palette");
        const colorType = palette.dataset.colorType;

        toggle.addEventListener("mousedown", (event) => {
          event.preventDefault();
          saveSelection(name);

          toolbar.querySelectorAll(".color-palette").forEach((other) => {
            if (other !== palette) other.classList.add("hidden");
          });

          palette.classList.toggle("hidden");
        });

        palette.querySelectorAll(".color-dot").forEach((dot) => {
          dot.addEventListener("mousedown", (event) => {
            event.preventDefault();
            saveSelection(name);
            applyCommand(name, colorType, dot.dataset.color);
            palette.classList.add("hidden");
          });
        });
      });

      const imageButton = toolbar.querySelector(`[data-image-for="${name}"]`);
      const imageInput = toolbar.querySelector(`[data-image-input="${name}"]`);

      imageButton.addEventListener("mousedown", (event) => {
        event.preventDefault();
        saveSelection(name);
        imageInput.click();
      });

      imageInput.addEventListener("change", () => {
        const file = imageInput.files?.[0];
        if (!file) return;

        if (!file.type.startsWith("image/")) {
          alert("Selecione um arquivo de imagem.");
          imageInput.value = "";
          return;
        }

        const reader = new FileReader();
        reader.onload = () => {
          insertImage(name, reader.result, file.name || "Imagem");
          imageInput.value = "";
        };
        reader.readAsDataURL(file);
      });
    });
  }


  document.addEventListener("mousedown", (event) => {
    if (!event.target.closest(".color-control")) {
      document.querySelectorAll(".color-palette").forEach((palette) => palette.classList.add("hidden"));
    }
  });

  window.OituEditor = {
    init,
    sanitizeHtml,
    hasContent,
    plainTextFromHtml,
    resetEditors,
    setEditors,
    editorFor
  };
})();
