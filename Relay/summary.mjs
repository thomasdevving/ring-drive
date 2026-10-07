// Spoken incident summaries. Generated once when an incident is created or changes, stored, and read
// at tap time, so the driver never waits for a model. A deterministic template is always available.
import AnthropicBedrock from '@anthropic-ai/bedrock-sdk';
import {absenceSummary} from './absence.mjs';

export const DEFAULT_MODEL = 'anthropic.claude-opus-5-5';
export const DEFAULT_TIME_ZONE = 'Europe/Amsterdam';
const ZONE_LABELS = {front:'front entrance', side:'side entrance', rear:'rear door', unknown:'unmapped camera'};
const KIND_LABELS = {person:'Person activity', motion:'Motion', doorbell:'A doorbell press', package:'A package', departed:'A departure'};

export const clockTime = (ms, timeZone) => new Intl.DateTimeFormat('en-GB', {timeZone, hour:'2-digit', minute:'2-digit', hourCycle:'h23'}).format(new Date(ms));
const cameraOf = o => o.cameraName?.trim() || ZONE_LABELS[o.zone] || 'a camera';

/** Consecutive observations at the same camera of the same kind form one segment with a duration. */
export function segments(observations) {
  const sorted = [...observations].sort((a,b) => a.atMs - b.atMs), result = [];
  for (const o of sorted) {
    const last = result.at(-1), end = o.endMs ?? o.atMs;
    if (last && last.camera === cameraOf(o) && last.kind === o.kind) { last.lastMs = Math.max(last.lastMs, end); last.count++; continue; }
    result.push({camera:cameraOf(o), zone:o.zone, kind:o.kind, firstMs:o.atMs, lastMs:end, count:1});
  }
  return result.map(s => ({...s, seconds:Math.round((s.lastMs - s.firstMs) / 1000)}));
}

/** The only information the model sees. No names, labels for people, or identifiers. */
export function incidentFacts(incident) {
  const timeZone = incident.window?.timeZone ?? incident.timeZone ?? DEFAULT_TIME_ZONE;
  if (incident.type === 'ABSENCE') {
    return {kind:'absence', ruleName:incident.ruleName, window:{start:incident.window.start, end:incident.window.end},
      exitCameras:incident.cameras.map(c => c.label), expected:incident.expectedEventType === 'motion' ? 'motion' : 'a person',
      observedInWindow:0, simulated:!!incident.simulated};
  }
  return {kind:'camera activity', priority:incident.priority, simulated:!!incident.simulated, timeZone,
    sequence:segments(incident.observations ?? []).map(s => ({camera:s.camera, observation:KIND_LABELS[s.kind] ?? 'Activity',
      from:clockTime(s.firstMs, timeZone), to:clockTime(s.lastMs, timeZone), seconds:s.seconds, observations:s.count})),
    videoLocked:true};
}

export function templateSummary(incident) {
  if (incident.type === 'ABSENCE') return absenceSummary({name:incident.ruleName, expectedEventType:incident.expectedEventType, exitCameras:incident.cameras, window:incident.window});
  const facts = incidentFacts(incident), steps = facts.sequence.slice(-4);
  if (!steps.length) return 'Ring Drive received a camera update. Video stays locked until you are parked.';
  const sentences = steps.map((s, i) => {
    const when = s.seconds >= 5 ? `from ${s.from} to ${s.to}, for ${s.seconds} seconds` : `at ${s.from}`;
    return `${i ? 'Then ' + s.observation.toLowerCase() : s.observation} at the ${s.camera.replace(/^the /i,'')} ${when}.`;
  });
  return `${sentences.join(' ')} Video stays locked until you are parked.`;
}

export const SYSTEM_PROMPT = `You write short spoken alerts that a driver hears through the car speakers. The input is JSON facts from home security cameras.

Rules:
- Describe only what the facts say the cameras observed: which cameras, in what order, at what times, and for how long.
- Never speculate about who someone is, what they intend, or whether anyone is in danger. Never use words such as burglar, intruder, thief, stranger, suspicious, break-in, threat or danger.
- For an absence, say which cameras recorded no activity during the window. Never say where any person is, and never say that someone has or has not left.
- Use only times and durations that appear in the facts. Write times as HH:MM and durations in whole seconds.
- If the facts say the video is locked, end by saying the video stays locked until the driver is parked.
- Write two or three short sentences of plain spoken English, at most 60 words, with no lists, markdown, or quotation marks.`;

const BANNED = /\b(burglar\w*|intrud\w*|thie[fv]\w*|theft|steal\w*|suspicious\w*|stranger\w*|break[- ]?in\w*|criminal\w*|attack\w*|threat\w*|danger\w*|robber\w*|prowler\w*|trespass\w*)/i;
const ABSENCE_BANNED = /\b(leav\w*|left|still (at )?home|at home|missing|is home|not home|went out)\b/i;

/** Returns null when acceptable, otherwise the reason the output must fall back to the template. */
export function rejectReason(text, incident) {
  if (!text) return 'empty';
  if (text.length > 450 || text.split(/[.!?](\s|$)/).filter(s => s.trim()).length > 4) return 'too long';
  if (BANNED.test(text)) return 'speculative wording';
  if (incident.type === 'ABSENCE' && ABSENCE_BANNED.test(text)) return 'claims about a person';
  if (/[*#`|]|^\s*-/m.test(text)) return 'formatting';
  const facts = incidentFacts(incident);
  const times = new Set(incident.type === 'ABSENCE' ? [facts.window.start, facts.window.end] : facts.sequence.flatMap(s => [s.from, s.to]));
  for (const [, h, m] of text.matchAll(/\b(\d{1,2})[:.](\d{2})\b/g)) if (!times.has(`${h.padStart(2,'0')}:${m}`)) return 'unsupported time';
  const seconds = new Set(incident.type === 'ABSENCE' ? [] : facts.sequence.map(s => s.seconds));
  for (const [, n] of text.matchAll(/\b(\d+)\s*seconds?\b/gi)) if (!seconds.has(Number(n))) return 'unsupported duration';
  return null;
}

export function bedrockClientFromEnv(env = process.env) {
  if (env.BEDROCK_ENABLED === '0' || !env.AWS_REGION) return null;
  if (!env.AWS_ACCESS_KEY_ID && !env.AWS_PROFILE && !env.AWS_BEARER_TOKEN_BEDROCK) return null;
  // InvokeModel on bedrock-runtime: matches an IAM policy scoped to bedrock:InvokeModel.
  return new AnthropicBedrock({awsRegion:env.AWS_REGION, maxRetries:1});
}

export class Summarizer {
  constructor({client = null, model = DEFAULT_MODEL, timeoutMs = 15000, now = () => Date.now(), log = () => {}} = {}) {
    Object.assign(this, {client, model, timeoutMs, now, log});
  }
  /** Never throws. Returns the stored summary record. */
  async summarize(incident) {
    const at = new Date(this.now()).toISOString(), basedOn = incident.observations?.length ?? 0;
    const template = {text:templateSummary(incident), source:'template', generatedAt:at, basedOn};
    if (!this.client) return {...template, fallbackReason:'Bedrock not configured'};
    let timer;
    try {
      const request = this.client.messages.create({model:this.model, max_tokens:2000, output_config:{effort:'low'}, system:SYSTEM_PROMPT,
        messages:[{role:'user', content:JSON.stringify(incidentFacts(incident))}]}, {timeout:this.timeoutMs});
      const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('timeout'), {code:'timeout'})), this.timeoutMs + 1000); });
      const response = await Promise.race([request, timeout]);
      if (response.stop_reason !== 'end_turn') return {...template, fallbackReason:`stop reason ${response.stop_reason}`};
      const text = response.content.filter(b => b.type === 'text').map(b => b.text).join(' ').replace(/\s+/g,' ').trim();
      const reason = rejectReason(text, incident);
      if (reason) { this.log(`Bedrock summary rejected: ${reason}`); return {...template, fallbackReason:`rejected: ${reason}`}; }
      return {text, source:'bedrock', model:this.model, generatedAt:new Date(this.now()).toISOString(), basedOn};
    } catch (error) {
      const reason = error.code === 'timeout' || error.name === 'APIConnectionTimeoutError' ? 'timeout' : `Bedrock error${error.status ? ` HTTP ${error.status}` : ''}`;
      this.log(`Bedrock summary failed: ${reason}`);
      return {...template, fallbackReason:reason};
    } finally { clearTimeout(timer); }
  }
}
