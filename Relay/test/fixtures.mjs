import {validateRule} from '../absence.mjs';

export const schoolRule = (overrides = {}) => ({
  id:'rule-1', createdAt:'2026-10-01T00:00:00.000Z',
  ...validateRule({name:'School run', personLabel:'Child', daysOfWeek:['mon','tue','wed','thu','fri'],
    window:{start:'07:30', end:'08:15'}, timeZone:'Europe/Amsterdam',
    exitCameras:[{deviceId:'front',label:'front door'},{deviceId:'side',label:'side gate'},{deviceId:'back',label:'back door'}], ...overrides})
});
