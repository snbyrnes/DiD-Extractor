/* Builds the concept index straight from a local SNOMED CT RF2 release folder,
   so no terminology content ever has to be shipped with this site.

   Reads three Snapshot files (Concept, Description, Language refset) and emits
   the same shape the app has always consumed:
     { version, module, concepts: { <conceptId>: {a,e,d,ld:{<refsetId>:{...}}} } }

   The Language refset is ~158 MB / 1.6M rows, so every file is streamed and
   parsed a chunk at a time rather than read into one string.

   Exposed as window.RF2. */
(function (root) {
  "use strict";

  const FSN = '900000000000003001', SYN = '900000000000013009';
  const PREFERRED = '900000000000548007';
  const IRISH = '21000220103', US = '900000000000509007';
  const DEFAULT_MODULE = '1601000220105';

  // ---- release discovery ----

  // Flatten the chosen source into { name, path, getFile() } entries. Accepts a
  // FileSystemDirectoryHandle (Chrome/Edge picker) or the FileList from an
  // <input webkitdirectory> so Firefox and Safari work too.
  async function listEntries(source, onProgress) {
    const out = [];
    let seen = 0;
    const note = () => { if (onProgress && ++seen % 50 === 0) onProgress(seen + ' files'); };

    // FileList is itself iterable, so test for the handle explicitly.
    if (source && source.kind === 'directory') {
      const walk = async (handle, path, depth) => {
        if (depth > 6) return;
        for await (const entry of handle.values()) {
          const p = path + '/' + entry.name;
          if (entry.kind === 'directory') {
            if (/^(Full|Delta)$/i.test(entry.name)) continue;   // variants we never read
            await walk(entry, p, depth + 1);
          } else {
            note();
            out.push({ name: entry.name, path: p, getFile: () => entry.getFile() });
          }
        }
      };
      await walk(source, '', 0);
      return out;
    }

    for (const f of Array.from(source || [])) {
      const p = f.webkitRelativePath || f.name;
      if (/(^|\/)(Full|Delta)\//i.test(p)) continue;
      note();
      out.push({ name: f.name, path: p, getFile: () => Promise.resolve(f) });
    }
    return out;
  }

  // Pick the Snapshot RF2 files we need. The user may point at the release root,
  // the SnomedCT_* folder, or Snapshot itself, so match on filename + path.
  async function findFiles(source, onProgress) {
    const want = {
      concept:     /^sct2_Concept_Snapshot.*\.txt$/i,
      description: /^sct2_Description_Snapshot.*\.txt$/i,
      language:    /^der2_cRefset_LanguageSnapshot.*\.txt$/i
    };
    const found = { concept: null, description: [], language: [] };
    const entries = await listEntries(source, d => onProgress && onProgress('scanning… ' + d));

    for (const e of entries) {
      if (!/Snapshot/i.test(e.path)) continue;
      if (want.concept.test(e.name)) { if (!found.concept) found.concept = e; }
      else if (want.description.test(e.name)) found.description.push(e);
      else if (want.language.test(e.name)) found.language.push(e);
    }

    const missing = [];
    if (!found.concept) missing.push('sct2_Concept_Snapshot');
    if (!found.description.length) missing.push('sct2_Description_Snapshot');
    if (!found.language.length) missing.push('der2_cRefset_LanguageSnapshot');
    if (missing.length) {
      throw new Error('No RF2 Snapshot files found — missing ' + missing.join(', ') +
        '. Pick the folder you extracted the release zip into.');
    }
    return found;
  }

  // Release date from a filename like ..._IE1000220_20260821.txt
  function versionFrom(name) {
    const m = /_(\d{8})\.txt$/i.exec(name || '');
    return m ? m[1] : '';
  }

  // ---- streaming line reader ----

  // Yields complete lines from a File without materialising the whole thing.
  async function eachLine(file, onLine, onBytes) {
    const reader = file.stream().pipeThrough(new TextDecoderStream('utf-8')).getReader();
    let rest = '', bytes = 0, sinceTick = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      sinceTick += value.length;
      let text = rest + value, start = 0, nl;
      while ((nl = text.indexOf('\n', start)) !== -1) {
        let line = text.slice(start, nl);
        if (line.charCodeAt(line.length - 1) === 13) line = line.slice(0, -1);   // CRLF
        if (line) onLine(line);
        start = nl + 1;
      }
      rest = text.slice(start);
      if (onBytes && sinceTick > 4e6) { sinceTick = 0; onBytes(bytes); await tick(); }
    }
    if (rest) {
      if (rest.charCodeAt(rest.length - 1) === 13) rest = rest.slice(0, -1);
      if (rest) onLine(rest);
    }
  }

  // let the UI repaint between chunks
  function tick() { return new Promise(r => setTimeout(r)); }

  // Reads one tab-separated field without splitting the whole row. The language
  // refset is the hot loop, and most of its rows are discarded on field 5.
  function field(line, idx) {
    let start = 0;
    for (let i = 0; i < idx; i++) {
      start = line.indexOf('\t', start);
      if (start === -1) return '';
      start++;
    }
    const end = line.indexOf('\t', start);
    return end === -1 ? line.slice(start) : line.slice(start, end);
  }

  // ---- build ----

  // The steps the caller can render, in order.
  const STEPS = [
    { key: 'scan',         label: 'Finding release files' },
    { key: 'concepts',     label: 'Reading concepts' },
    { key: 'descriptions', label: 'Reading descriptions' },
    { key: 'language',     label: 'Reading language reference set' },
    { key: 'index',        label: 'Building index' }
  ];

  // opts: { module, onProgress({ step, detail, frac, overall }) }
  async function build(dir, opts) {
    opts = opts || {};
    const emit = (step, detail, frac, overall) => {
      if (opts.onProgress) opts.onProgress({ step, detail, frac, overall });
    };

    emit('scan', 'looking for RF2 Snapshot files…', null, 0);
    await tick();
    const files = await findFiles(dir, d => emit('scan', d, null, 0));

    // Resolve every File up front so the total byte count — and therefore an
    // honest overall percentage — is known before any parsing starts.
    const conceptFile = await files.concept.getFile();
    const descFiles = [];
    for (const e of files.description) descFiles.push(await e.getFile());
    const langFiles = [];
    for (const e of files.language) langFiles.push(await e.getFile());

    const total = conceptFile.size +
      descFiles.reduce((n, f) => n + f.size, 0) +
      langFiles.reduce((n, f) => n + f.size, 0);
    let doneBytes = 0;
    const overallAt = b => total ? (doneBytes + b) / total : 0;

    emit('scan', descFiles.length + langFiles.length + 1 + ' files · ' + mb(total) + ' MB to read', 1, 0);
    await tick();

    const version = versionFrom(files.concept.name) || versionFrom(conceptFile.name);

    // 1. concepts, grouped by module so the caller can offer a choice
    emit('concepts', conceptFile.name, 0, overallAt(0));
    await tick();
    const byModule = new Map();
    let header = true;
    await eachLine(conceptFile, line => {
      if (header) { header = false; return; }
      const id = field(line, 0);
      if (!id) return;
      const mod = field(line, 3);
      let m = byModule.get(mod);
      if (!m) { m = new Map(); byModule.set(mod, m); }
      m.set(id, { a: field(line, 2) === '1' ? 'T' : 'F', e: field(line, 1), d: '', ld: {} });
    }, b => emit('concepts', mb(b) + ' of ' + mb(conceptFile.size) + ' MB', b / conceptFile.size, overallAt(b)));
    doneBytes += conceptFile.size;

    const modules = [...byModule.entries()]
      .map(([id, m]) => ({ id, count: m.size }))
      .sort((a, b) => b.count - a.count);
    const module = (opts.module && byModule.has(opts.module)) ? opts.module
      : (byModule.has(DEFAULT_MODULE) ? DEFAULT_MODULE : (modules[0] && modules[0].id));
    if (!module) throw new Error('No concepts found in the release.');
    const concepts = byModule.get(module);
    byModule.clear();
    emit('concepts', concepts.size.toLocaleString() + ' concepts in module ' + module, 1, overallAt(0));
    await tick();

    // 2. active descriptions belonging to those concepts
    const descs = new Map();
    for (const f of descFiles) {
      emit('descriptions', f.name, 0, overallAt(0));
      await tick();
      let head = true;
      await eachLine(f, line => {
        if (head) { head = false; return; }
        if (field(line, 2) !== '1') return;
        const conceptId = field(line, 4);
        if (!concepts.has(conceptId)) return;
        descs.set(field(line, 0), {
          conceptId,
          language: field(line, 5),
          typeId: field(line, 6),
          text: field(line, 7)
        });
      }, b => emit('descriptions', mb(b) + ' of ' + mb(f.size) + ' MB', b / f.size, overallAt(b)));
      doneBytes += f.size;
    }
    emit('descriptions', descs.size.toLocaleString() + ' descriptions kept', 1, overallAt(0));
    await tick();

    // 3. language refset decides FSN / preferred / acceptable per refset
    for (const f of langFiles) {
      emit('language', f.name + ' — ' + mb(f.size) + ' MB, this is the big one', 0, overallAt(0));
      await tick();
      let head = true;
      await eachLine(f, line => {
        if (head) { head = false; return; }
        const descId = field(line, 5);
        const d = descs.get(descId);
        if (!d) return;                       // not our module — the common case
        if (field(line, 2) !== '1') return;   // inactive membership
        const con = concepts.get(d.conceptId);
        if (!con) return;
        const refset = field(line, 4);
        let slot = con.ld[refset];
        if (!slot) slot = con.ld[refset] = { fsn: null, preferredTerm: null, acceptableFsns: [], acceptableTerms: [] };
        const rec = { id: descId, language: d.language, text: d.text, typeId: d.typeId };
        const preferred = field(line, 6) === PREFERRED;
        if (d.typeId === FSN) {
          if (preferred) slot.fsn = rec; else slot.acceptableFsns.push(rec);
        } else {
          if (preferred) slot.preferredTerm = rec; else slot.acceptableTerms.push(rec);
        }
      }, b => emit('language', mb(b) + ' of ' + mb(f.size) + ' MB', b / f.size, overallAt(b)));
      doneBytes += f.size;
    }

    // 4. display term, mirroring how the app resolves it
    emit('index', 'resolving display terms…', 0, 1);
    await tick();
    const out = {};
    for (const [id, con] of concepts) {
      const ie = con.ld[IRISH], us = con.ld[US];
      const p = (ie && ie.preferredTerm) || (us && us.preferredTerm);
      con.d = p ? p.text : '';
      out[id] = con;
    }
    emit('index', concepts.size.toLocaleString() + ' concepts indexed', 1, 1);

    return { version, module, modules, concepts: out, builtAt: Date.now() };
  }

  function mb(n) { return (n / 1048576).toFixed(0); }

  // ---- IndexedDB: cached index + the folder handle ----

  const DB = 'did-extractor', STORE = 'kv';

  function idb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE); };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function kv(mode, fn) {
    const db = await idb();
    return new Promise((res, rej) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => res(req && req.result);
      tx.onerror = () => rej(tx.error);
    });
  }

  const cache = {
    get:    ()  => kv('readonly',  s => s.get('index')),
    put:    v   => kv('readwrite', s => s.put(v, 'index')),
    clear:  ()  => kv('readwrite', s => s.delete('index')),
    getDir: ()  => kv('readonly',  s => s.get('dir')),
    putDir: h   => kv('readwrite', s => s.put(h, 'dir')),
    clearDir: ()=> kv('readwrite', s => s.delete('dir'))
  };

  root.RF2 = { build, cache, STEPS, DEFAULT_MODULE, supportsPicker: typeof root.showDirectoryPicker === 'function' };
})(typeof self !== 'undefined' ? self : this);
