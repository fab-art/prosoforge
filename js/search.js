/* ============================================================================
   Research Workstation — search.js
   Literature search across 6 free academic APIs (CrossRef, OpenAlex,
   Semantic Scholar, arXiv, PubMed, DOAJ) + dedupe by normalized title.
   Each adapter returns Paper[] and degrades gracefully on failure.
============================================================================ */
(function(){
  "use strict";
  const RW = window.RW = window.RW || {};
  const { toast, dedupePapers, stripTags, uid, SOURCE_LABELS } = RW;

  async function fetchJSON(url, opts={}){
    const res = await fetch(url, opts);
    if(!res.ok) throw new Error("HTTP "+res.status);
    return res.json();
  }
  async function fetchText(url, opts={}){
    const res = await fetch(url, opts);
    if(!res.ok) throw new Error("HTTP "+res.status);
    return res.text();
  }

  // --- CrossRef ---
  async function searchCrossRef(q){
    const url = `https://api.crossref.org/works?query=${encodeURIComponent(q)}&rows=15&select=DOI,title,author,abstract,published-print,published-online,URL,container-title`;
    const data = await fetchJSON(url);
    return (data.message?.items||[]).map(it=>{
      const yr = (it["published-print"]?.["date-parts"]||it["published-online"]?.["date-parts"]||[[null]])[0][0];
      return {
        id:"cr-"+(it.DOI||uid()), source:"crossref",
        title: it.title?.[0] || "(untitled)",
        authors: (it.author||[]).map(a=> a.family ? `${a.family}, ${a.given||""}`.trim() : a.name||""),
        year: yr, doi: it.DOI, url: it.URL,
        abstract: it.abstract ? stripTags(it.abstract) : "",
        venue: it["container-title"]?.[0] || ""
      };
    });
  }

  // --- OpenAlex ---
  function reconstructAbstract(invIndex){
    if(!invIndex) return "";
    const positions = [];
    for(const word in invIndex){ for(const pos of invIndex[word]){ positions.push([pos, word]); } }
    positions.sort((a,b)=>a[0]-b[0]);
    return positions.map(p=>p[1]).join(" ");
  }
  async function searchOpenAlex(q){
    const url = `https://api.openalex.org/works?search=${encodeURIComponent(q)}&per-page=15&mailto=research-workstation@example.org`;
    const data = await fetchJSON(url);
    return (data.results||[]).map(it=>({
      id:"oa-"+(it.id||"").replace("https://openalex.org/",""),
      source:"openalex",
      title: it.display_name || "(untitled)",
      authors: (it.authorships||[]).slice(0,8).map(a=>a.author?.display_name||""),
      year: it.publication_year,
      doi: it.doi ? it.doi.replace("https://doi.org/","") : "",
      url: it.doi || it.id || "",
      abstract: reconstructAbstract(it.abstract_inverted_index),
      venue: it.host_venue?.display_name || ""
    }));
  }

  // --- Semantic Scholar ---
  async function searchSemanticScholar(q){
    const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(q)}&limit=15&fields=title,authors,year,abstract,externalIds,url`;
    const data = await fetchJSON(url);
    return (data.data||[]).map(it=>({
      id:"ss-"+(it.paperId||uid()),
      source:"semantic",
      title: it.title || "(untitled)",
      authors: (it.authors||[]).map(a=>a.name||""),
      year: it.year,
      doi: it.externalIds?.DOI || "",
      url: it.url || (it.externalIds?.DOI? "https://doi.org/"+it.externalIds.DOI : ""),
      abstract: it.abstract || "",
      venue: ""
    }));
  }

  // --- arXiv (Atom XML) ---
  async function searchArxiv(q){
    const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(q)}&max_results=15&sortBy=relevance`;
    const xml = await fetchText(url);
    const doc = new DOMParser().parseFromString(xml,"application/xml");
    const entries = Array.from(doc.getElementsByTagName("entry"));
    return entries.map(e=>{
      const get=(t)=>e.getElementsByTagName(t)[0]?.textContent?.trim()||"";
      const id=get("id");
      const authors=Array.from(e.getElementsByTagName("author")).map(a=>a.getElementsByTagName("name")[0]?.textContent?.trim()||"");
      return {
        id:"ax-"+(id.split("/abs/")[1]||uid()),
        source:"arxiv",
        title: get("title").replace(/\s+/g," "),
        authors,
        year: get("published").slice(0,4) || null,
        doi: "",
        url: id,
        abstract: get("summary").replace(/\s+/g," "),
        venue: "arXiv"
      };
    });
  }

  // --- PubMed (E-utilities: esearch + efetch XML) ---
  async function searchPubMed(q){
    const esearch = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(q)}&retmax=15&retmode=json`;
    const sdata = await fetchJSON(esearch);
    const ids = sdata.esearchresult?.idlist||[];
    if(!ids.length) return [];
    const efetch = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${ids.join(",")}&rettype=abstract&retmode=xml`;
    const xml = await fetchText(efetch);
    const doc = new DOMParser().parseFromString(xml,"application/xml");
    const arts = Array.from(doc.getElementsByTagName("PubmedArticle"));
    return arts.map(a=>{
      const get=(t)=>a.getElementsByTagName(t)[0]?.textContent?.trim()||"";
      const title=a.getElementsByTagName("ArticleTitle")[0]?.textContent?.trim()||"(untitled)";
      const authors=Array.from(a.getElementsByTagName("Author")).slice(0,8).map(au=>{
        const ln=au.getElementsByTagName("LastName")[0]?.textContent||"";
        const fn=au.getElementsByTagName("ForeName")[0]?.textContent||"";
        return ln? `${ln}, ${fn}`.trim() : (au.getElementsByTagName("CollectiveName")[0]?.textContent||"");
      }).filter(Boolean);
      const abstractEls=Array.from(a.getElementsByTagName("AbstractText"));
      const abstract=abstractEls.map(el=>{
        const lbl=el.getAttribute("Label");
        const txt=el.textContent.trim();
        return lbl? `${lbl}: ${txt}` : txt;
      }).join(" ");
      const year=a.getElementsByTagName("PubDate")[0]?.getElementsByTagName("Year")[0]?.textContent || null;
      const pmid=get("PMID");
      return {
        id:"pm-"+pmid, source:"pubmed",
        title: title.replace(/\s+/g," "),
        authors, year: year?parseInt(year):null,
        doi: "", url: pmid? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`:"",
        abstract, venue: a.getElementsByTagName("Title")[0]?.textContent||""
      };
    });
  }

  // --- DOAJ ---
  async function searchDOAJ(q){
    const url = `https://doaj.org/api/search/articles/${encodeURIComponent(q)}?page=1&pageSize=15`;
    const data = await fetchJSON(url);
    return (data.results||[]).map(r=>{
      const b=r.bibjson||{};
      return {
        id:"dj-"+(r.id||uid()),
        source:"doaj",
        title: b.title||"(untitled)",
        authors:(b.author||[]).map(a=>a.name||""),
        year: b.year?parseInt(b.year):null,
        doi: b.identifier?.find(i=>i.type==="doi")?.id || "",
        url: b.link?.[0]?.url || "",
        abstract: b.abstract||"",
        venue: b.journal?.title||""
      };
    });
  }

  const SOURCE_FUNCS = {
    crossref: searchCrossRef, openalex: searchOpenAlex, semantic: searchSemanticScholar,
    arxiv: searchArxiv, pubmed: searchPubMed, doaj: searchDOAJ
  };

  async function runSearch(query, sources){
    const enabled = Object.keys(sources).filter(k=>sources[k]);
    if(!enabled.length){ toast("Select at least one source.","error"); return []; }
    const results = await Promise.allSettled(
      enabled.map(k=>SOURCE_FUNCS[k](query).catch(e=>{ toast(`${SOURCE_LABELS[k]} failed: ${e.message}`,"error"); return []; }))
    );
    const all = [];
    results.forEach(r=>{ if(r.status==="fulfilled") all.push(...r.value); });
    return dedupePapers(all);
  }

  Object.assign(RW, {
    Search: { runSearch, SOURCE_FUNCS, SOURCE_LABELS,
      searchCrossRef, searchOpenAlex, searchSemanticScholar, searchArxiv, searchPubMed, searchDOAJ }
  });
})();
