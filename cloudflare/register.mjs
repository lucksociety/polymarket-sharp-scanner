import {register} from './discord.mjs';
import {predictionsCommand} from './predictions.mjs';
const token=process.env.DISCORD_BOT_TOKEN;
if(!token){console.error('Set DISCORD_BOT_TOKEN in the process environment; do not put it in source control.');process.exitCode=1;}
else{try{console.log(JSON.stringify(await register(token,fetch,process.argv[2]==='predictions'?predictionsCommand:undefined)));}catch(e){console.error(e.message);process.exitCode=1;}}
