import { pathToFileURL } from 'node:url';

const API_BASE = 'https://points.russlib.ca/api/feedback';
const REPOSITORY = 'russlib/points-feedback';
const MAX_PENDING_ITEMS = 20;
const MAX_ISSUE_PAGES = 10;
const MARKER_PREFIX = '<!-- points-feedback:';

function requireEnvironment(name, value) {
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function neutralizeMentions(value) {
  return String(value ?? '').replaceAll('@', '@\u200b');
}

function truncate(value, maximum) {
  return Array.from(value).slice(0, maximum).join('');
}

export function issueTitle(item) {
  const type = neutralizeMentions(String(item.type ?? 'feedback').trim() || 'feedback');
  const firstLine = neutralizeMentions(String(item.message ?? '').split(/\r?\n/, 1)[0].trim());
  const prefix = `${type}: `;
  return truncate(`${prefix}${firstLine || 'Anonymous feedback'}`, 100);
}

export function issueBody(item) {
  const id = String(item.id ?? '');
  const message = neutralizeMentions(item.message);
  return [
    'Submitted anonymously from https://points.russlib.ca/.',
    '',
    `${MARKER_PREFIX}${id} -->`,
    '',
    message,
  ].join('\n');
}

function markerFor(id) {
  return `${MARKER_PREFIX}${String(id)} -->`;
}

async function jsonRequest(fetchImpl, url, options, context) {
  let response;
  try {
    response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(20000) });
  } catch {
    throw new Error(`${context} request failed`);
  }
  if (!response.ok) throw new Error(`${context} failed with HTTP ${response.status}`);
  try {
    return await response.json();
  } catch {
    throw new Error(`${context} returned invalid JSON`);
  }
}

function githubHeaders(githubToken) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${githubToken}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'points-feedback-sync',
  };
}

export async function listExistingMarkers({ fetchImpl, githubToken }) {
  const markers = new Map();
  const headers = githubHeaders(githubToken);
  for (let page = 1; page <= MAX_ISSUE_PAGES; page += 1) {
    const issues = await jsonRequest(
      fetchImpl,
      `https://api.github.com/repos/${REPOSITORY}/issues?state=all&per_page=100&page=${page}`,
      { headers },
      'GitHub issue listing',
    );
    if (!Array.isArray(issues)) throw new Error('GitHub issue listing returned an unexpected response');
    for (const issue of issues) {
      const body = typeof issue.body === 'string' ? issue.body : '';
      const match = body.match(/<!-- points-feedback:([^\s>]+) -->/);
      if (match && Number.isInteger(issue.number)) markers.set(match[1], issue.number);
    }
    if (issues.length < 100) break;
    if(page === MAX_ISSUE_PAGES) throw new Error("Issue history exceeds safe reconciliation limit");
  }
  return markers;
}

async function createIssue({ fetchImpl, githubToken, item }) {
  const issue = await jsonRequest(
    fetchImpl,
    `https://api.github.com/repos/${REPOSITORY}/issues`,
    {
      method: 'POST',
      headers: { ...githubHeaders(githubToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: issueTitle(item), body: issueBody(item) }),
    },
    'GitHub issue creation',
  );
  if (!Number.isInteger(issue.number)) throw new Error('GitHub issue creation returned no issue number');
  return issue.number;
}

async function acknowledge({ fetchImpl, feedbackToken, id, issueNumber }) {
  await jsonRequest(
    fetchImpl,
    `${API_BASE}/ack`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${feedbackToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ id, issue_number: issueNumber }),
    },
    'Feedback acknowledgement',
  );
}

export async function runSync({
  fetchImpl = globalThis.fetch,
  feedbackToken = process.env.FEEDBACK_SYNC_TOKEN,
  githubToken = process.env.GITHUB_TOKEN,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('Fetch is unavailable');
  requireEnvironment('FEEDBACK_SYNC_TOKEN', feedbackToken);
  requireEnvironment('GITHUB_TOKEN', githubToken);

  const pending = await jsonRequest(
    fetchImpl,
    `${API_BASE}/pending`,
    { headers: { Authorization: `Bearer ${feedbackToken}` } },
    'Pending feedback retrieval',
  );
  if (!pending || !Array.isArray(pending.items)) throw new Error('Pending feedback response is invalid');

  const items = [...pending.items]
    .filter((item) => item && item.id != null && typeof item.message === 'string')
    .sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))
    .slice(0, MAX_PENDING_ITEMS);
  if (!items.length) return;
  const existing = await listExistingMarkers({ fetchImpl, githubToken });

  for (const item of items) {
    const id = String(item.id);
    const issueNumber = existing.get(id) ?? await createIssue({ fetchImpl, githubToken, item });
    existing.set(id, issueNumber);
    await acknowledge({ fetchImpl, feedbackToken, id, issueNumber });
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  runSync().catch((error) => {
    // Deliberately omit response bodies: they can contain anonymous submissions or secrets.
    console.error(error.message);
    process.exitCode = 1;
  });
}
