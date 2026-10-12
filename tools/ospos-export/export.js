// OpenSourcePOS 3.3.x full export (read-only).
// Run inside a browser tab where you are ALREADY logged in to OSPOS (any OSPOS page).
// It only sends GET requests to OSPOS's own pages and reports, keeps everything in memory,
// and when finished `window.__osposDownload()` saves ospos-export-<date>.json.
// Progress: window.__osposExport.status / .step / .progress / .errors
(() => {
  if (window.__osposExport && window.__osposExport.status === 'running') return 'already running';
  const E = (window.__osposExport = {
    status: 'running',
    step: 'start',
    progress: '',
    errors: [],
    startedAt: new Date().toISOString(),
  });
  const m =
    location.href.match(/^(.*?\/public\/)/) || location.href.match(/^(https?:\/\/[^/]+\/(?:index\.php\/)?)/);
  const BASE = m[1];
  const PAUSE = 250; // ms between requests, keeps the shop server responsive
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const pad = (n) => String(n).padStart(2, '0');

  async function get(path) {
    let last = '';
    for (let i = 0; i < 4; i++) {
      try {
        const r = await fetch(BASE + path, { credentials: 'include' });
        const t = await r.text();
        if (r.status === 200) {
          if (/name=["']password["']/i.test(t) && /login/i.test(t)) throw new Error('SESSION_EXPIRED');
          return t;
        }
        last = 'HTTP ' + r.status;
      } catch (e) {
        if (e.message === 'SESSION_EXPIRED') throw e;
        last = e.message;
      }
      await sleep(1500 * (i + 1));
    }
    E.errors.push(path + ' -> ' + last);
    return null;
  }
  async function getJson(path) {
    const t = await get(path);
    if (!t) return null;
    try {
      return JSON.parse(t);
    } catch (e) {
      E.errors.push(path + ' -> not JSON');
      return null;
    }
  }
  // Pull a JSON literal that follows `marker` (optionally after `anchor`) out of a page's inline script.
  function extractJson(text, marker, anchor) {
    if (!text) return null;
    let from = 0;
    if (anchor) {
      from = text.indexOf(anchor);
      if (from < 0) return null;
    }
    const at = text.indexOf(marker, from);
    if (at < 0) return null;
    let i = at + marker.length;
    while (i < text.length && text[i] !== '[' && text[i] !== '{') i++;
    let depth = 0,
      inStr = false,
      esc = false;
    for (let k = i; k < text.length; k++) {
      const c = text[k];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === '[' || c === '{') depth++;
      else if (c === ']' || c === '}') {
        depth--;
        if (depth === 0) return JSON.parse(text.slice(i, k + 1));
      }
    }
    return null;
  }
  const strip = (h) => {
    if (h === null || h === undefined) return '';
    const d = new DOMParser().parseFromString('<div>' + h + '</div>', 'text/html');
    return d.body.textContent.trim();
  };
  const href = (h) => {
    if (!h) return '';
    const d = new DOMParser().parseFromString(String(h), 'text/html');
    const a = d.querySelector('a[href]');
    return a ? a.getAttribute('href') : '';
  };
  function formValues(html) {
    const d = new DOMParser().parseFromString(html, 'text/html');
    const o = {};
    d.querySelectorAll('input[name], select[name], textarea[name]').forEach((el) => {
      const n = el.getAttribute('name');
      if (/csrf|token/i.test(n) || el.type === 'password') return;
      if (el.type === 'checkbox' || el.type === 'radio') {
        if (el.checked) o[n] = el.value;
        else if (!(n in o) && el.type === 'checkbox') o[n] = '';
        return;
      }
      if (el.tagName === 'SELECT') {
        const s = el.querySelector('option[selected]') || el.options[el.selectedIndex];
        o[n] = s ? s.value : '';
        return;
      }
      o[n] = el.tagName === 'TEXTAREA' ? el.textContent : el.value;
    });
    return o;
  }
  async function pagedSearch(path, label) {
    const rows = [];
    for (let offset = 0; ; offset += 500) {
      E.progress = `${label} ${offset}`;
      const d = await getJson(`${path}${path.includes('?') ? '&' : '?'}offset=${offset}&limit=500`);
      if (!d) break;
      rows.push(...d.rows);
      if (offset + 500 >= +d.total) break;
      await sleep(PAUSE);
    }
    return rows;
  }
  function months(fromY, toY, toM) {
    const out = [];
    for (let y = fromY; y <= toY; y++)
      for (let mo = 1; mo <= 12; mo++) {
        if (y === toY && mo > toM) break;
        out.push([y, mo]);
      }
    return out;
  }
  // Plain Y-m-d works when OSPOS "date or time format" is off (this shop). If it is on, OSPOS expects
  // full datetimes; detect empty months against salesSearchTotal in the validation step.
  const monthRange = (y, mo) => {
    const last = new Date(y, mo, 0).getDate();
    return [`${y}-${pad(mo)}-01`, `${y}-${pad(mo)}-${pad(last)}`];
  };

  (async () => {
    const out = {
      meta: {
        source: 'OpenSourcePOS',
        base: BASE,
        exportedAt: E.startedAt,
        title: document.title,
        format: 'ospos-browser-export/1',
      },
    };
    try {
      E.step = 'items';
      out.items = (
        await pagedSearch(
          'items/search?search=&order=asc&sort=items.item_id&start_date=2000-01-01&end_date=2030-12-31&stock_location=1&filters%5B%5D=',
          'items',
        )
      ).map((r) => {
        const o = {};
        for (const [k, v] of Object.entries(r))
          if (!['inventory', 'stock', 'edit', 'item_pic'].includes(k))
            o[k] = typeof v === 'string' ? strip(v) : v;
        o.item_pic_url = href(r.item_pic);
        return o;
      });

      E.step = 'inventory_summary';
      const inv = await get('reports/inventory_summary/all/all');
      out.inventory_summary = extractJson(inv, 'data:', 'exportTypes') || [];

      E.step = 'customers';
      const cust = await pagedSearch('customers/search?search=&order=asc&sort=people.person_id', 'customers');
      out.customers = [];
      for (const r of cust) {
        E.progress = 'customer ' + r['people.person_id'];
        const html = await get('customers/view/' + r['people.person_id']);
        out.customers.push({
          person_id: +r['people.person_id'],
          list: {
            first_name: r.first_name,
            last_name: r.last_name,
            email: strip(r.email),
            phone_number: r.phone_number,
            total_spent: strip(r.total),
          },
          form: html ? formValues(html) : null,
        });
        await sleep(PAUSE);
      }

      E.step = 'suppliers';
      const sup = await pagedSearch('suppliers/search?search=&order=asc&sort=people.person_id', 'suppliers');
      out.suppliers = [];
      for (const r of sup) {
        E.progress = 'supplier ' + r['people.person_id'];
        const html = await get('suppliers/view/' + r['people.person_id']);
        out.suppliers.push({
          person_id: +r['people.person_id'],
          list: {
            company_name: r.company_name,
            agency_name: r.agency_name,
            category: r.category,
            first_name: r.first_name,
            last_name: r.last_name,
            email: strip(r.email),
            phone_number: r.phone_number,
          },
          form: html ? formValues(html) : null,
        });
        await sleep(PAUSE);
      }

      E.step = 'employees';
      out.employees = (
        await pagedSearch('employees/search?search=&order=asc&sort=people.person_id', 'employees')
      ).map((r) => ({ person_id: +r['people.person_id'], first_name: r.first_name, last_name: r.last_name }));

      E.step = 'expenses';
      out.expenses = (
        await pagedSearch(
          'expenses/search?search=&order=asc&start_date=2000-01-01&end_date=2030-12-31&filters%5B%5D=',
          'expenses',
        )
      ).map((r) => {
        const o = {};
        for (const [k, v] of Object.entries(r)) if (k !== 'edit') o[k] = typeof v === 'string' ? strip(v) : v;
        return o;
      });

      E.step = 'first sale';
      const first = await getJson(
        'sales/search?search=&order=asc&sort=sale_time&offset=0&limit=1&start_date=2000-01-01&end_date=2030-12-31&filters%5B%5D=',
      );
      const firstYear =
        first && first.rows[0] ? +(String(first.rows[0].sale_time).match(/(\d{4})/) || [0, 2015])[1] : 2015;
      out.meta.salesSearchTotal = first ? +first.total : null;
      const now = new Date();

      out.sales = [];
      out.sale_lines = {};
      out.receivings = [];
      out.receiving_lines = {};
      for (const [y, mo] of months(firstYear, now.getFullYear(), now.getMonth() + 1)) {
        const [s, e] = monthRange(y, mo);
        E.step = 'sales + receivings';
        E.progress = `${y}-${pad(mo)}`;
        const sh = await get(`reports/detailed_sales/${s}/${e}/complete/all`);
        if (sh) {
          if (!out.meta.saleLineColumns)
            out.meta.saleLineColumns = extractJson(sh, 'columns:', 'onExpandRow');
          for (const r of extractJson(sh, 'data:', 'exportTypes') || []) {
            delete r.edit;
            for (const k in r) if (typeof r[k] === 'string') r[k] = strip(r[k]);
            out.sales.push(r);
          }
          Object.assign(out.sale_lines, extractJson(sh, 'var details_data =') || {});
        }
        await sleep(PAUSE);
        const rh = await get(`reports/detailed_receivings/${s}/${e}/all/all`);
        if (rh) {
          if (!out.meta.receivingLineColumns)
            out.meta.receivingLineColumns = extractJson(rh, 'columns:', 'onExpandRow');
          for (const r of extractJson(rh, 'data:', 'exportTypes') || []) {
            delete r.edit;
            for (const k in r) if (typeof r[k] === 'string') r[k] = strip(r[k]);
            out.receivings.push(r);
          }
          Object.assign(out.receiving_lines, extractJson(rh, 'var details_data =') || {});
        }
        await sleep(PAUSE);
      }
      // anything before the first sale year (receivings/expenses entered earlier)
      const early = await get(`reports/detailed_receivings/2000-01-01/${firstYear - 1}-12-31/all/all`);
      for (const r of extractJson(early, 'data:', 'exportTypes') || []) {
        delete r.edit;
        out.receivings.push(r);
      }
      Object.assign(out.receiving_lines, extractJson(early, 'var details_data =') || {});

      out.meta.counts = {
        items: out.items.length,
        inventory_rows: out.inventory_summary.length,
        customers: out.customers.length,
        suppliers: out.suppliers.length,
        employees: out.employees.length,
        expenses: out.expenses.length,
        sales: out.sales.length,
        sale_line_groups: Object.keys(out.sale_lines).length,
        receivings: out.receivings.length,
        receiving_line_groups: Object.keys(out.receiving_lines).length,
      };
      out.meta.finishedAt = new Date().toISOString();
      out.meta.errors = E.errors;
      E.data = out;
      E.status = 'done';
      E.step = 'done';
      E.progress = '';
    } catch (err) {
      E.status = 'failed';
      E.error = err.message;
      E.partial = out;
    }
  })();

  window.__osposDownload = () => {
    const d = window.__osposExport && (window.__osposExport.data || window.__osposExport.partial);
    if (!d) return 'nothing to download yet';
    const blob = new Blob([JSON.stringify(d)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ospos-export-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    return a.download + ' (' + Math.round(blob.size / 1024) + ' KB)';
  };
  return 'started';
})();
