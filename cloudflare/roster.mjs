// Same tracked roster and sport classifier as the dashboard.
export const CORE = [
  { name:"BreakTheBank",     wallet:"0xf0318c32136c2db7fec88b84869aee6a1106c80c", spec:"NFL · NBA" },
  { name:"googleplay",       wallet:"0xe9b710551dd82a44e79203c2394a2b10163ace7b", spec:"NBA" },
  { name:"mooseborzoii",     wallet:"0x1f3a646ce5cbe2c70270e7a46161d89b7c7b895d", spec:"NFL" },
  { name:"joseph00677",      wallet:"0xcdcccd0f2d86e450d973da415ad2430e5cc7935a", spec:"Soccer" },
  { name:"beachboy4",        wallet:"0xc2e7800b5af46e6093872b177b7a5e7f0563be51", spec:"Soccer" },
  { name:"mintblade",        wallet:"0x96cfcb0c30942cfcd1cdf76c7d408794d66b1acb", spec:"Soccer" },
  { name:"frostrizz",        wallet:"0xbc11a64ab34a03a043fbe80598fa065ee87eeec6", spec:"Soccer" },
  { name:"sparklingwater123",wallet:"0x664ce9fb97ae1bbd538d7381b2f4e92dab16f49c", spec:"Soccer" },
  { name:"DEEDDIT",          wallet:"0x09b428f7c2b469786286214aa5c90dd9015f7320", spec:"Soccer" },
  { name:"fishalive",        wallet:"0xed64a7bf029040aa331abc87902434d815ef217d", spec:"Soccer" },
  { name:"fengdubiying",     wallet:"0x17db3fcd93ba12d38382a0cade24b200185c5f6d", spec:"LoL" },
  { name:"Mooseborzoiii",    wallet:"0x57a85952044f2c8e4d31b475aab6987d2f98ebc2", spec:"LoL" },
  { name:"Diabolical-Prize", wallet:"0x7c37b52eb226bcb9411375ec48b0169663fb6aeb", spec:"LoL · CS" },
  { name:"bossoskil1",       wallet:"0xa5ea13a81d2b7e8e424b182bdc1db08e756bd96a", spec:"Esports" },
  { name:"swisstony",        wallet:"0x204f72f35326db932158cba6adff0b9a1da95e14", spec:"All sports" },
  { name:"RN1",              wallet:"0x2005d16a84ceefa912d4e380cd32e7ff827875ea", spec:"All sports" },
  { name:"kch123",           wallet:"0x6a72f61820b26b1fe4d956e17b6dc2a1ea3033ee", spec:"All sports" },
  { name:"HomeRunHazard",    wallet:"0x5268527977f700f9bf9b6d5cd843859e4e70135d", spec:"MLB?" },
];
export function classify(tags, slug){
  const t = new Set(tags); const s = slug||"";
  if (t.has("nfl") || s.startsWith("nfl-")) return "NFL";
  if (t.has("nba") || s.startsWith("nba-")) return "NBA";
  if (t.has("nhl") || s.startsWith("nhl-")) return "NHL";
  if (t.has("mlb") || s.startsWith("mlb-")) return "MLB";
  if (t.has("ufc") || t.has("mma") || s.startsWith("ufc-")) return "UFC";
  if (t.has("league-of-legends") || t.has("lol") || s.startsWith("lol-")) return "LoL";
  if (t.has("tennis") || s.startsWith("atp-") || s.startsWith("wta-")) return "Tennis";
  if (t.has("soccer")) return "Soccer";
  if (t.has("sports") || t.has("esports") || t.has("games")) return "Other sports";
  return "Non-sports";
}
export const SPORTS=["All","NFL","NBA","NHL","MLB","UFC","Soccer","Tennis","LoL","Other sports"];
