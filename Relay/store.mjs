import {randomUUID} from 'node:crypto';
import {readFile, writeFile, rename, mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';

const OBSERVATION_RETENTION_MS = 24 * 3600000;
const LIMITS = {rules:200, incidents:500, runs:2000, observations:5000};

/**
 * Single-household JSON store for rules, rule runs, backend incidents and recent observations.
 * Writes are serialized and atomic. A null path keeps everything in memory (tests, dry demos).
 * Replaceable by DynamoDB later; callers only use the methods below.
 */
export class Store {
  static async open(path, now = () => Date.now()) {
    const store = new Store(path, now);
    if (path) {
      try { Object.assign(store.data, JSON.parse(await readFile(path,'utf8'))); }
      catch (error) { if (error.code !== 'ENOENT') throw new Error(`Cannot read ${path}. Fix or move the file; it is never overwritten silently.`); }
    }
    return store;
  }
  constructor(path, now = () => Date.now()) { this.path = path; this.now = now; this.data = {rules:[], runs:[], incidents:[], observations:[]}; this.writing = Promise.resolve(); }
  async save() {
    if (!this.path) return;
    const snapshot = JSON.stringify(this.data, null, 1);
    this.writing = this.writing.then(async () => {
      await mkdir(dirname(this.path), {recursive:true});
      await writeFile(this.path + '.tmp', snapshot, {mode:0o600});
      await rename(this.path + '.tmp', this.path);
    });
    return this.writing;
  }
  #cap(name) { const list = this.data[name]; if (list.length > LIMITS[name]) list.splice(0, list.length - LIMITS[name]); }

  rules() { return this.data.rules; }
  rule(id) { return this.data.rules.find(r => r.id === id) ?? null; }
  async createRule(fields) {
    const at = new Date(this.now()).toISOString();
    const rule = {id:randomUUID(), ...fields, createdAt:at, updatedAt:at};
    this.data.rules.push(rule); this.#cap('rules'); await this.save(); return rule;
  }
  async replaceRule(id, fields) {
    const index = this.data.rules.findIndex(r => r.id === id); if (index < 0) return null;
    const old = this.data.rules[index];
    this.data.rules[index] = {id, ...fields, createdAt:old.createdAt, updatedAt:new Date(this.now()).toISOString()};
    await this.save(); return this.data.rules[index];
  }
  async deleteRule(id) {
    const before = this.data.rules.length; this.data.rules = this.data.rules.filter(r => r.id !== id);
    if (before === this.data.rules.length) return false; await this.save(); return true;
  }

  run(key) { return this.data.runs.find(r => r.key === key) ?? null; }
  runsFor(ruleId) { return this.data.runs.filter(r => r.ruleId === ruleId); }
  /** One run per rule window; a retried UNCHECKED run is replaced in place. */
  async putRun(run) {
    const index = this.data.runs.findIndex(r => r.key === run.key);
    if (index >= 0) this.data.runs[index] = run; else { this.data.runs.push(run); this.#cap('runs'); }
    await this.save(); return run;
  }

  incidents() { return [...this.data.incidents].sort((a,b) => b.createdAt.localeCompare(a.createdAt)); }
  incident(id) { return this.data.incidents.find(i => i.id === id) ?? null; }
  async createIncident(fields) {
    const incident = {id:randomUUID(), createdAt:new Date(this.now()).toISOString(), ...fields};
    if (this.incident(incident.id)) throw new Error('Incident already exists');
    this.data.incidents.push(incident); this.#cap('incidents'); await this.save(); return incident;
  }

  /** Applies a mutation to a stored incident and saves; returns the updated incident or null. */
  async updateIncident(id, mutate) {
    const incident = this.incident(id); if (!incident) return null;
    mutate(incident); incident.updatedAt = new Date(this.now()).toISOString();
    await this.save(); return incident;
  }

  /** Observations from signed webhooks or the simulation endpoint, kept 24 h for absence rules. */
  async addObservation(observation) {
    const cutoff = this.now() - OBSERVATION_RETENTION_MS;
    this.data.observations = this.data.observations.filter(o => o.startMs >= cutoff);
    if (this.data.observations.some(o => o.id === observation.id)) return false;
    this.data.observations.push(observation); this.#cap('observations'); await this.save(); return true;
  }
  observations({simulated, sinceMs}) {
    return this.data.observations.filter(o => o.simulated === simulated && (o.endMs ?? o.startMs) >= sinceMs);
  }
}
