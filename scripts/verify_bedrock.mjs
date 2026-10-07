// One live Bedrock summary for a labeled synthetic incident. Prints the outcome, never credentials.
import {loadEnvFile} from 'node:process';
import {Summarizer, bedrockClientFromEnv, DEFAULT_MODEL} from '../Relay/summary.mjs';

try { loadEnvFile(new URL('../Relay/.env.local', import.meta.url)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const client = bedrockClientFromEnv();
if (!client) { console.error('Set AWS_REGION and AWS credentials in Relay/.env.local (see README → Amazon Bedrock).'); process.exit(2); }
const minute = 60000, start = Date.now() - 5 * minute;
const incident = {id:'00000000-0000-4000-8000-000000000000', type:'INTRUSION', priority:'urgent', simulated:true, timeZone:'Europe/Amsterdam', observations:[
  {id:'1', deviceId:'demo-side', zone:'side', kind:'person', atMs:start, confidence:0.94},
  {id:'2', deviceId:'demo-rear', zone:'rear', kind:'person', atMs:start + minute, confidence:0.94},
  {id:'3', deviceId:'demo-rear', zone:'rear', kind:'person', atMs:start + minute + 85000, confidence:0.94}]};
const model = process.env.BEDROCK_MODEL_ID || DEFAULT_MODEL;
const started = Date.now();
const summary = await new Summarizer({client, model, timeoutMs:Number(process.env.BEDROCK_TIMEOUT_MS) || 15000}).summarize(incident);
console.log(JSON.stringify({model, region:process.env.AWS_REGION, source:summary.source, fallbackReason:summary.fallbackReason ?? null, ms:Date.now() - started, text:summary.text}, null, 2));
process.exitCode = summary.source === 'bedrock' ? 0 : 1;
