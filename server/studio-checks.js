// Automatic checks for Open Research Studio submissions: the creator's ORCID iD and NPI number and the
// cited studies are looked up in public registries, and the wording and prototype are scanned.
// The results go to the reviewer and the creator. A definite "fail" (a record that doesn't exist)
// sends the submission back for changes; nothing here can publish one.
//
// Every lookup has a short timeout. A registry that can't be reached gives a "warn" for the
// reviewer to check by hand, never a "fail".

const TIMEOUT_MS = 8000;
const USER_AGENT = 'Chemoasis Open Research Studio (registry check)';

// ---------- identifiers ----------

// "https://orcid.org/0000-0002-1825-0097" or "0000-0002-1825-0097" -> "0000-0002-1825-0097"
function normalizeOrcid(input) {
  const match = String(input || '').trim().match(/(\d{4}-\d{4}-\d{4}-\d{3}[\dXx])\/?$/);
  return match ? match[1].toUpperCase() : null;
}

// ORCID's last character is an ISO 7064 MOD 11-2 check digit.
function orcidChecksumOk(id) {
  const digits = String(id).replace(/-/g, '');
  if (!/^\d{15}[\dX]$/.test(digits)) return false;
  let total = 0;
  for (let i = 0; i < 15; i++) total = (total + Number(digits[i])) * 2;
  const result = (12 - (total % 11)) % 11;
  return (result === 10 ? 'X' : String(result)) === digits[15];
}

// An NPI's last digit is a Luhn check digit over "80840" plus its first nine digits.
function npiChecksumOk(npi) {
  if (!/^\d{10}$/.test(String(npi))) return false;
  const payload = '80840' + npi.slice(0, 9);
  let sum = 0;
  for (let i = 0; i < payload.length; i++) {
    let digit = Number(payload[payload.length - 1 - i]);
    if (i % 2 === 0) { digit *= 2; if (digit > 9) digit -= 9; }
    sum += digit;
  }
  return (10 - (sum % 10)) % 10 === Number(npi[9]);
}

// A DOI, a doi.org link, a PubMed link or a PMID -> { kind: 'doi' | 'pmid', id }, or null.
function parseResearchLink(input) {
  const text = String(input || '').trim();
  const pubmed = text.match(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d{1,9})/i) || text.match(/^(?:pmid:?\s*)?(\d{1,9})$/i);
  if (pubmed) return { kind: 'pmid', id: pubmed[1] };
  let decoded = text;
  try { decoded = decodeURIComponent(text); } catch (_) { /* keep it as typed */ }
  const doi = decoded.match(/(10\.\d{4,9}\/[^\s"<>]+)/);
  if (doi) return { kind: 'doi', id: doi[1].replace(/[.,;)\]]+$/, '') };
  return null;
}

// Does the name on the submission contain the registry's family name? Accents and case are ignored.
function simplify(name) {
  return String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z\s'-]/g, ' ').split(/[\s'-]+/).filter(Boolean);
}
function nameMatches(displayName, familyName) {
  const shown = new Set(simplify(displayName));
  const family = simplify(familyName);
  return family.length > 0 && family.every((part) => shown.has(part));
}

// ---------- lookups ----------

async function getJson(fetchImpl, url, headers = {}) {
  const res = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (res.status === 404) return { notFound: true };
  if (!res.ok) throw new Error('registry answered ' + res.status);
  return { json: await res.json() };
}

async function getText(fetchImpl, url) {
  const res = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error('registry answered ' + res.status);
  return res.text();
}

const clip = (text, max) => String(text || '').replace(/\s+/g, ' ').trim().slice(0, max);
const stripTags = (text) => String(text || '').replace(/<[^>]*>/g, ' ');

async function checkOrcid(fetchImpl, orcid, name) {
  const item = { key: 'orcid', label: 'ORCID iD' };
  try {
    const { json, notFound } = await getJson(fetchImpl, `https://pub.orcid.org/v3.0/${orcid}/person`);
    if (notFound) return { ...item, status: 'fail', message: 'There is no ORCID record with this iD. Please check it.' };
    const n = (json && json.name) || {};
    const given = n['given-names'] && n['given-names'].value;
    const family = n['family-name'] && n['family-name'].value;
    if (!family) return { ...item, status: 'warn', message: "The ORCID record exists, but its name isn't public, so a reviewer will confirm it's yours." };
    const recordName = [given, family].filter(Boolean).join(' ');
    if (nameMatches(name, family)) return { ...item, status: 'pass', message: `Matches the ORCID record for ${recordName}.`, record: { name: recordName } };
    return { ...item, status: 'warn', message: `The ORCID record is for ${recordName}, which doesn't match the name you gave. A reviewer will check.`, record: { name: recordName } };
  } catch (error) {
    return { ...item, status: 'warn', message: "We couldn't reach ORCID just now, so a reviewer will check the iD by hand." };
  }
}

async function checkNpi(fetchImpl, npi, name) {
  const item = { key: 'npi', label: 'NPI number' };
  try {
    const { json } = await getJson(fetchImpl, `https://npiregistry.cms.hhs.gov/api/?version=2.1&number=${npi}`);
    const result = json && Array.isArray(json.results) && json.results[0];
    if (!result) return { ...item, status: 'fail', message: 'There is no provider with this NPI number in the US registry. Please check it.' };
    const basic = result.basic || {};
    if (!basic.last_name) return { ...item, status: 'warn', message: 'This NPI number belongs to an organization, not a person. A reviewer will check.' };
    const recordName = [basic.first_name, basic.last_name].filter(Boolean).map((p) => p.charAt(0) + p.slice(1).toLowerCase()).join(' ');
    const taxonomy = (result.taxonomies || []).find((t) => t.primary) || (result.taxonomies || [])[0];
    const address = (result.addresses || [])[0] || {};
    const record = { name: recordName, specialty: taxonomy ? clip(taxonomy.desc, 120) : '', state: clip(address.state, 4) };
    if (nameMatches(name, basic.last_name)) return { ...item, status: 'pass', message: `Matches the NPI record for ${recordName}${record.specialty ? ' (' + record.specialty + ')' : ''}.`, record };
    return { ...item, status: 'warn', message: `The NPI record is for ${recordName}, which doesn't match the name you gave. A reviewer will check.`, record };
  } catch (error) {
    return { ...item, status: 'warn', message: "We couldn't reach the NPI registry just now, so a reviewer will check the number by hand." };
  }
}

// One cited study. Returns what the public listing shows (title, journal, year, link) plus, for
// the reviewer and the advisory review only, the abstract when the registry has one.
async function checkStudy(fetchImpl, entry) {
  const parsed = parseResearchLink(entry.link);
  const base = { link: entry.link, note: entry.note };
  if (!parsed) return { ...base, status: 'fail', message: "This isn't a DOI or a PubMed link." };
  try {
    if (parsed.kind === 'doi') {
      const { json, notFound } = await getJson(fetchImpl, `https://api.crossref.org/works/${encodeURIComponent(parsed.id)}`);
      if (notFound || !json || !json.message) return { ...base, status: 'fail', message: 'No published work has this DOI.' };
      const work = json.message;
      const parts = (work.issued && work.issued['date-parts'] && work.issued['date-parts'][0]) || [];
      return {
        ...base, status: 'pass', message: 'Found in Crossref.',
        title: clip(stripTags((work.title || [])[0]), 300), journal: clip((work['container-title'] || [])[0], 200),
        year: parts[0] ? String(parts[0]) : '', url: `https://doi.org/${parsed.id}`,
        abstract: clip(stripTags(work.abstract), 2500)
      };
    }
    const { json } = await getJson(fetchImpl, `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=${parsed.id}`);
    const doc = json && json.result && json.result[parsed.id];
    if (!doc || doc.error) return { ...base, status: 'fail', message: 'No PubMed record has this ID.' };
    let abstract = '';
    try { abstract = clip(await getText(fetchImpl, `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&rettype=abstract&retmode=text&id=${parsed.id}`), 2500); } catch (_) { /* the summary is enough */ }
    return {
      ...base, status: 'pass', message: 'Found in PubMed.',
      title: clip(doc.title, 300), journal: clip(doc.fulljournalname || doc.source, 200),
      year: (String(doc.pubdate || '').match(/\d{4}/) || [''])[0], url: `https://pubmed.ncbi.nlm.nih.gov/${parsed.id}/`, abstract
    };
  } catch (error) {
    return { ...base, status: 'warn', message: "We couldn't reach the registry just now, so a reviewer will look this study up by hand." };
  }
}

// ---------- scans ----------

// Words that usually promise more than a study of an activity can show.
const OVERCLAIMS = [
  /\bcur(e|es|ed|ing)\b/i, /\bheal(s|ed|ing)?\b/i, /\brevers(e|es|ed|ing)\b/i, /\beliminat(e|es|ed|ing)\b/i,
  /\bguarantee(s|d)?\b/i, /\bclinically proven\b/i, /\bproven to\b/i, /\bscientifically proven\b/i,
  /\bFDA[- ]approved\b/i, /\bmedically approved\b/i, /\btreats\b/i, /\bprevents?\b/i, /\brestores?\b/i
];

function scanWording(texts) {
  const found = new Set();
  for (const text of texts) for (const pattern of OVERCLAIMS) {
    const match = String(text || '').match(pattern);
    if (match) found.add(match[0].toLowerCase());
  }
  if (!found.size) return { key: 'wording', label: 'Wording', status: 'pass', message: 'No words that promise a medical result.' };
  return { key: 'wording', label: 'Wording', status: 'warn', message: `Words that can promise more than the research shows: ${[...found].map((w) => '"' + w + '"').join(', ')}. A reviewer will compare them with the studies.` };
}

const PROTOTYPE_RULES = [
  [/\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon/, 'tries to use the internet (published activities must work on their own)'],
  [/\b(src|href|action)\s*=\s*["']?\s*(https?:)?\/\//i, 'loads files from other websites (everything has to be inside the one file)'],
  [/localStorage|sessionStorage|indexedDB|document\.cookie/, 'tries to save data on the device'],
  [/<form\b|type\s*=\s*["']?(email|tel|password)\b/i, 'has a form (activities must not collect personal information)']
];

function scanPrototype(html, kind) {
  const item = { key: 'prototype', label: 'Prototype' };
  if (kind !== 'html' || !html) return { ...item, status: 'warn', message: 'No playable prototype, so the reviewer will judge the written plan.' };
  const problems = PROTOTYPE_RULES.filter(([pattern]) => pattern.test(html)).map(([, message]) => message);
  if (!problems.length) return { ...item, status: 'pass', message: 'Runs on its own, with no internet, storage or forms.' };
  return { ...item, status: 'warn', message: `The prototype ${problems.join('; ')}. The sandbox blocks all of this, so parts may not work.` };
}

// ---------- everything ----------

async function runChecks(fetchImpl, data, prototype) {
  const { creator, activity } = data;
  const items = [];
  const orcid = normalizeOrcid(creator.orcid);
  const lookups = [];
  if (orcid) lookups.push(checkOrcid(fetchImpl, orcid, creator.name));
  if (creator.npi) lookups.push(checkNpi(fetchImpl, creator.npi, creator.name));
  const [credentialResults, research] = await Promise.all([
    Promise.all(lookups),
    Promise.all(data.research.map((entry) => checkStudy(fetchImpl, entry)))
  ]);
  items.push(...credentialResults);
  items.push(scanWording([activity.title, activity.summary, activity.howToPlay, activity.claim]));
  items.push(scanPrototype(prototype, data.prototypeKind));
  return { ranAt: new Date().toISOString(), items, research };
}

const hasFail = (checks) => checks.items.some((i) => i.status === 'fail') || checks.research.some((r) => r.status === 'fail');

module.exports = { runChecks, hasFail, normalizeOrcid, orcidChecksumOk, npiChecksumOk, parseResearchLink, nameMatches, scanWording, scanPrototype };
