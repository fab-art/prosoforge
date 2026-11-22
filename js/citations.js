/* ============================================================================
   Research Workstation — citations.js
   APA / MLA / Chicago (author-date) citation formatters + in-text citation
   builders. Author input may be array or ";"/newline-separated string of
   "Last, First" or "First Last" forms.
============================================================================ */
(function(){
  "use strict";
  const RW = window.RW = window.RW || {};

  function parseAuthors(input){
    const arr = Array.isArray(input) ? input : (input||"").split(/;|\n/);
    return arr.map(s=>String(s).trim()).filter(Boolean);
  }

  function parseAuthor(a){
    if(a.includes(",")){
      const [last, ...rest] = a.split(",").map(s=>s.trim());
      return { last: last||"", rest: rest.join(", ").trim() };
    }
    const parts = a.split(/\s+/);
    const last = parts.length>1 ? parts[parts.length-1] : a;
    const rest = parts.length>1 ? parts.slice(0,-1).join(" ") : "";
    return { last, rest };
  }

  function apaAuthor(a){
    const { last, rest } = parseAuthor(a);
    if(!rest) return last;
    const initials = rest.split(/\s+/).map(s=>(s[0]||"").toUpperCase()+".").join(" ");
    return `${last}, ${initials}`;
  }
  function mlaAuthor(a){
    const { last, rest } = parseAuthor(a);
    return rest ? `${last}, ${rest}` : last;
  }
  function chiAuthor(a){
    const { last, rest } = parseAuthor(a);
    return rest ? `${rest} ${last}` : last;
  }
  function joinOxford(items, conj, trailingComma){
    if(items.length<=1) return items[0]||"";
    if(items.length===2) return `${items[0]} ${conj} ${items[1]}`;
    return `${items.slice(0,-1).join(", ")}${trailingComma?",":""} ${conj} ${items[items.length-1]}`;
  }

  function formatCitation(c, style){
    const authors = parseAuthors(c.authors);
    const year = c.year || "n.d.";
    const title = c.title || "";
    const venue = c.venue || c.journal || "";
    const url = c.url || "";
    const doi = c.doi || "";

    let auth = "Anonymous";
    if(authors.length){
      if(style==="apa")      auth = joinOxford(authors.map(apaAuthor), "&", true);
      else if(style==="mla") auth = joinOxford(authors.map(mlaAuthor), "and", false);
      else                   auth = joinOxford(authors.map(chiAuthor), "and", false);
    }
    if(style==="apa"){
      let s = `${auth} (${year}). ${title}`;
      if(venue) s += `, ${venue}`;
      if(doi) s += `. https://doi.org/${doi}`;
      else if(url) s += `. ${url}`;
      s += ".";
      return s;
    }
    if(style==="mla"){
      let s = `${auth}. "${title}."`;
      if(venue) s += ` ${venue},`;
      s += ` ${year}.`;
      if(url) s += ` ${url}.`;
      return s;
    }
    // chicago author-date
    let s = `${auth}. "${title}."`;
    if(venue) s += ` ${venue},`;
    s += ` ${year}.`;
    if(doi) s += ` https://doi.org/${doi}.`;
    else if(url) s += ` ${url}.`;
    return s;
  }

  function lastNameOf(a){
    if(a.includes(",")) return a.split(",")[0].trim();
    const parts = a.split(/\s+/);
    return parts.length>1 ? parts[parts.length-1] : a;
  }

  function inText(c, style){
    const authors = parseAuthors(c.authors);
    let name = "Anon";
    if(authors.length){
      const first = lastNameOf(authors[0]);
      if(authors.length===1) name = first;
      else if(authors.length===2) name = `${first} & ${lastNameOf(authors[1])}`;
      else name = `${first} et al.`;
    }
    const year = c.year || "n.d.";
    if(style==="apa") return `(${name}, ${year})`;
    return `(${name} ${year})`; // mla + chicago author-date
  }

  Object.assign(RW, { formatCitation, inText, parseAuthors });
})();
