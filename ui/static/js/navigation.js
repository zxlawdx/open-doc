/* ============ OUTLINE AND LOCAL TEXT SEARCH ============ */
"use strict";
(() => {
  function create(root, editor, signal) {
    const outline = root.querySelector('[data-outline]');
    const input = root.querySelector('[data-find]');
    const results = root.querySelector('[data-find-results]');
    const rich = root.querySelector('[data-rich]');
    let timer;
    function update() {
      const content = root.querySelector('[data-surface]').dataset.editorMode === 'rich' ? rich : root.querySelector('[data-preview-pane]');
      const headings = Array.from(content.querySelectorAll('h1,h2,h3,h4,h5,h6'));
      outline.replaceChildren();
      if (!headings.length) {
        const empty = document.createElement('p'); empty.className = 'outline-empty';
        empty.textContent = 'Os títulos do documento aparecerão aqui.'; outline.append(empty);
      }
      headings.forEach((heading, index) => {
        const button = document.createElement('button');
        button.textContent = heading.textContent;
        button.dataset.level = heading.tagName.slice(1);
        button.addEventListener('click', () => {
          editor.setMode('rich');
          const target = rich.querySelectorAll('h1,h2,h3,h4,h5,h6')[index];
          target?.scrollIntoView({block: 'start', behavior: 'auto'});
          for (const item of outline.querySelectorAll('button')) item.dataset.active = String(item === button);
          rich.focus();
        }, {signal});
        outline.append(button);
      });
      if (input.value) search();
    }
    function selectMatch(offset, length) {
      editor.setMode('rich');
      const walker = document.createTreeWalker(rich, NodeFilter.SHOW_TEXT);
      let node, position = 0, startNode = null, endNode = null, start = 0, end = 0;
      while ((node = walker.nextNode())) {
        const next = position + node.textContent.length;
        if (startNode === null && offset < next) { startNode = node; start = offset - position; }
        if (offset + length <= next) { endNode = node; end = offset + length - position; break; }
        position = next;
      }
      if (!startNode || !endNode) return;
      const range = document.createRange(); range.setStart(startNode, start); range.setEnd(endNode, end);
      const selection = window.getSelection(); rich.focus(); selection.removeAllRanges(); selection.addRange(range);
      startNode.parentElement.scrollIntoView({block: 'center', behavior: 'auto'});
      editor.capture();
    }
    function search() {
      const query = input.value.trim().toLocaleLowerCase('pt-BR');
      results.replaceChildren();
      if (!query) return;
      const haystack = root.querySelector('[data-preview-pane]').textContent.toLocaleLowerCase('pt-BR');
      let offset = 0, count = 0;
      const found = [];
      while ((offset = haystack.indexOf(query, offset)) !== -1) {
        count++; if (found.length < 30) found.push(offset); offset += query.length;
      }
      const label = document.createElement('p'); label.textContent = count + (count === 1 ? ' resultado' : ' resultados'); results.append(label);
      for (const [occurrence, position] of found.entries()) {
        const button = document.createElement('button');
        button.textContent = haystack.slice(Math.max(0, position - 16), position + query.length + 30).trim();
        // Search selects against rich text offsets, using its actual text content.
        button.addEventListener('click', () => {
          const normalized = rich.textContent.toLocaleLowerCase('pt-BR');
          let index = -1, from = 0;
          for (let match = 0; match <= occurrence; match++) {
            index = normalized.indexOf(query, from);
            if (index < 0) break;
            from = index + query.length;
          }
          if (index >= 0) selectMatch(index, query.length);
        }, {signal});
        results.append(button);
      }
    }
    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(search, 140); }, {signal});
    root.addEventListener('open-doc:content', update, {signal});
    signal.addEventListener('abort', () => clearTimeout(timer), {once: true});
    update(); return {update, search, focus: () => { input.focus(); input.select(); }};
  }
  window.OpenDocNavigation = {create};
})();
