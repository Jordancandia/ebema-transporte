#!/usr/bin/env node
// bump-version.js — A-07 (Auditoría SIT EBEMA)
//
// Fija UNA sola versión de cache-busting en TODOS los archivos .js/.html que usan
// el patrón "?v=..." al final de un import/src de módulo. Se corre automáticamente
// desde DESPLEGAR_ABASTECIMIENTO.bat antes de cada commit.
//
// Por qué existe: el bug de Rutas/Tarifas vacías del 11-sep-2026 fue exactamente
// esto — se subió la versión de data.js en app.js pero no en los demás módulos que
// lo importan, y convivieron dos copias del módulo de datos con dos memoryDb
// distintos en la misma pestaña (ver memoria "Bug lazy-load version mismatch").
// El 14-sep-2026 se encontró el mismo problema de nuevo en rates.js, pegado en una
// versión vieja desde antes. Bumpear a mano archivo por archivo es un proceso que
// falla tarde o temprano porque depende de que una persona recuerde tocar cada
// import. Este script elimina ese paso humano: reescribe TODAS las referencias
// "?v=XXXXXXXX" del repo al mismo valor nuevo, de una sola pasada.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const EXTENSIONS = new Set(['.js', '.html']);
// Carpetas que no son parte de la app servida (QA, exportaciones, automatizaciones,
// análisis, funciones Supabase/Deno) — no tiene sentido tocarlas ni caminarlas.
const SKIP_DIRS = new Set([
  '.git', 'node_modules',
  'ebema-transporte-qa', 'Exportacion_BD_CSV',
  'automatizacion_indicadores', 'automatizacion_troncales',
  'analisis_cluster', 'Claude outputs', 'supabase',
]);
// Acepta el formato viejo (8 dígitos + letra opcional, ej. 20260914b) y el nuevo
// formato de este script (12 dígitos = YYYYMMDDHHmm), para poder migrar el repo
// completo la primera vez que se corre.
const VERSION_RE = /(\.(?:js|css))\?v=(?:\d{12}|\d{8}[a-z]?)/g;

function newVersion() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function walk(dir, files = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_e) {
    return files;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      walk(path.join(dir, entry.name), files);
    } else if (EXTENSIONS.has(path.extname(entry.name))) {
      files.push(path.join(dir, entry.name));
    }
  }
  return files;
}

function main() {
  const version = newVersion();
  const files = walk(ROOT);
  let changedFiles = 0;
  let totalReplacements = 0;

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    let count = 0;
    const updated = content.replace(VERSION_RE, (_match, ext) => {
      count++;
      return `${ext}?v=${version}`;
    });
    if (count > 0) {
      fs.writeFileSync(file, updated, 'utf8');
      changedFiles++;
      totalReplacements += count;
      console.log(`  ${path.relative(ROOT, file)}: ${count} referencia(s) -> ?v=${version}`);
    }
  }

  console.log('');
  console.log(`APP_VERSION = ${version}`);
  console.log(`${changedFiles} archivo(s) actualizado(s), ${totalReplacements} referencia(s) reescrita(s).`);
  console.log('');

  if (totalReplacements === 0) {
    console.log('AVISO: no se encontró ninguna referencia "?v=..." — revisar manualmente.');
  }
}

main();
