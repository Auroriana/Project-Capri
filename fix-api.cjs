const fs = require("fs");
let content = fs.readFileSync("C:/Users/Ataraxia/Desktop/Capri/web/api/index.js", "utf8");

// Update the import to include allChatModels
content = content.replace(
  "import {models,validateChat} from '../lib/models.js';",
  "import {models, allChatModels, validateChat} from '../lib/models.js';"
);

// Update the /api/status endpoint to use allChatModels
content = content.replace(
  "if(req.method==='GET'&&route==='/api/status')return send(200,{configured:!!configured(),geminiReady:!!process.env.GEMINI_API_KEY&&process.env.GEMINI_FREE_TIER_CONFIRMED==='true',models,",
  "if(req.method==='GET'&&route==='/api/status')return send(200,{configured:!!configured(),geminiReady:!!process.env.GEMINI_API_KEY&&process.env.GEMINI_FREE_TIER_CONFIRMED==='true',models:allChatModels(),"
);

fs.writeFileSync("C:/Users/Ataraxia/Desktop/Capri/web/api/index.js", content);
console.log("Done");