// Every outgoing household message goes through the outbox. Each channel can run in dry-run mode, in which
// the message is recorded on the incident timeline but not delivered.
//   app  → the member's Ring Drive inbox (polled by the app, shown as a local notification)
//   sms  → Amazon SNS Publish to a phone number
//   call → never automated: iOS requires the driver to confirm a call, so ladder steps skip call-only contacts

/** DRY_RUN: "all", "none", or a comma list of channels. Unset means "sms" (no real SMS unless asked for). */
export function dryRunChannels(value = process.env.DRY_RUN) {
  if (value === undefined || value === '') return new Set(['sms']);
  if (value === 'all' || value === '1') return new Set(['app','sms']);
  if (value === 'none' || value === '0') return new Set();
  return new Set(value.split(',').map(v => v.trim()).filter(Boolean));
}

export function snsSmsSenderFromEnv(env = process.env) {
  if (!env.AWS_REGION || (!env.AWS_ACCESS_KEY_ID && !env.AWS_PROFILE)) return null;
  return async ({phone, message}) => {
    const {SNSClient, PublishCommand} = await import('@aws-sdk/client-sns');
    const client = new SNSClient({region:env.SNS_REGION || env.AWS_REGION});
    const result = await client.send(new PublishCommand({PhoneNumber:phone, Message:message,
      MessageAttributes:{'AWS.SNS.SMS.SMSType':{DataType:'String', StringValue:'Transactional'}}}));
    return {providerId:result.MessageId};
  };
}

export class Outbox {
  constructor({dryRun = dryRunChannels(), sendSms = null, log = () => {}} = {}) { Object.assign(this, {dryRun, sendSms, log}); }
  /** Returns the delivery status for one recipient. Never throws. */
  async deliver(contact, message) {
    const channel = contact.channel ?? 'app';
    if (channel === 'call') return {channel, status:'skipped', reason:'Calls need the driver to start and confirm them'};
    if (this.dryRun.has(channel)) { this.log(`[dry-run] ${channel} to ${contact.name}: ${message}`); return {channel, status:'dry_run'}; }
    if (channel === 'app') return {channel, status:'delivered'};
    if (!this.sendSms) return {channel, status:'failed', reason:'SNS is not configured'};
    try { return {channel, status:'sent', ...(await this.sendSms({phone:contact.phone, message}))}; }
    catch (error) { this.log(`SMS to ${contact.name} failed: ${error.name ?? 'error'}`); return {channel, status:'failed', reason:error.name ?? 'SNS error'}; }
  }
}
