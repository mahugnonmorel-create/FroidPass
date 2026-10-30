// Périodes de rapport : mensuel 'AAAA-MM', trimestriel 'AAAA-Tn', semestriel 'AAAA-Sn', annuel 'AAAA'
export const MOIS_FR = ["janvier","février","mars","avril","mai","juin","juillet","août","septembre","octobre","novembre","décembre"];
export const TYPES_PERIODE = { mensuel: "Mensuel", trimestriel: "Trimestriel", semestriel: "Semestriel", annuel: "Annuel" };
const ord = n => n === 1 ? "1er" : n + "e";
export function periode(code) {
  let m, y, d0, n, type, lib;
  if ((m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(code))) { y = +m[1]; d0 = +m[2] - 1; n = 1; type = "mensuel"; lib = `${MOIS_FR[d0]} ${y}`; }
  else if ((m = /^(\d{4})-T([1-4])$/.exec(code))) { y = +m[1]; d0 = (m[2] - 1) * 3; n = 3; type = "trimestriel"; lib = `${ord(+m[2])} trimestre ${y}`; }
  else if ((m = /^(\d{4})-S([12])$/.exec(code))) { y = +m[1]; d0 = (m[2] - 1) * 6; n = 6; type = "semestriel"; lib = `${ord(+m[2])} semestre ${y}`; }
  else if ((m = /^(\d{4})$/.exec(code))) { y = +m[1]; d0 = 0; n = 12; type = "annuel"; lib = `année ${y}`; }
  else return null;
  const debut = Date.UTC(y, d0, 1), fin = Date.UTC(y, d0 + n, 1); // fin exclue
  const mois = Array.from({ length: n }, (_, k) => { const x = new Date(Date.UTC(y, d0 + k, 1)); return { code: x.toISOString().slice(0, 7), lib: MOIS_FR[x.getUTCMonth()] }; });
  return { code, type, nbMois: n, debut, fin, lib, titre: `Rapport ${TYPES_PERIODE[type].toLowerCase()} de maintenance`, mois };
}
// Les dernières périodes d'un type, la plus récente d'abord (période en cours incluse)
export function dernieresPeriodes(type, now = new Date()) {
  const y = now.getFullYear(), mo = now.getMonth(), out = [];
  if (type === "mensuel") for (let k = 0; k < 12; k++) { const x = new Date(Date.UTC(y, mo - k, 1)); out.push(x.toISOString().slice(0, 7)); }
  if (type === "trimestriel") { let q = Math.floor(mo / 3) + 1, yy = y; for (let k = 0; k < 8; k++) { out.push(`${yy}-T${q}`); if (--q === 0) { q = 4; yy--; } } }
  if (type === "semestriel") { let s = mo < 6 ? 1 : 2, yy = y; for (let k = 0; k < 4; k++) { out.push(`${yy}-S${s}`); if (--s === 0) { s = 2; yy--; } } }
  if (type === "annuel") for (let k = 0; k < 3; k++) out.push(String(y - k));
  return out.map(periode);
}
