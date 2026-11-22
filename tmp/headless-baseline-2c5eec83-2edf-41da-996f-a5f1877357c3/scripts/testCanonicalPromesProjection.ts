import { assertV21TimeProjectionContract } from './helpers/v21TimeProjectionContract';
// V21 authority: Unit → Meeting → Actual Schedule, not legacy ATP_ITEM allocation rows.
assertV21TimeProjectionContract('PROMES').catch(error=>{console.error(error);process.exitCode=1;});
