#!/usr/bin/env node
// Fails when a tracked file matches a runtime pattern of the managed .gitignore block.
// Patterns are the MANAGED_ENTRIES of rs-plugkit's gitignore.rs. Checks the parent
// and every submodule in .gitmodules; each submodule must be checked out.
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

const source = readFileSync('rs-plugkit/crates/plugkit-core/src/gitignore.rs', 'utf8')
const block = /pub const MANAGED_ENTRIES: &\[&str\] = &\[([\s\S]*?)\];/.exec(source)
if (!block) {
  console.error('MANAGED_ENTRIES not found in rs-plugkit/crates/plugkit-core/src/gitignore.rs')
  process.exit(2)
}
const patterns = [...block[1].matchAll(/"([^"]+)"/g)].map((match) => match[1])

const toRegex = (pattern) => {
  const body = pattern.replace(/\/$/, '')
  const anchored = body.includes('/')
  let re = ''
  for (let i = 0; i < body.length; i++) {
    if (body.startsWith('**/', i)) {
      re += '(?:.*/)?'
      i += 2
    } else if (body.startsWith('**', i)) {
      re += '.*'
      i += 1
    } else if (body[i] === '*') {
      re += '[^/]*'
    } else if (body[i] === '?') {
      re += '[^/]'
    } else {
      re += body[i].replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
  }
  return new RegExp(`${anchored ? '^' : '(?:^|/)'}${re}(?:/.*)?$`)
}
const matchers = patterns.map(toRegex)

const onDisk = process.argv.indexOf('--on-disk')
if (onDisk !== -1) {
  const root = process.argv[onDisk + 1]
  if (!root) {
    console.error('usage: check-runtime-tracked.mjs --on-disk <dir>')
    process.exit(2)
  }
  const listFiles = (dir, prefix = '') => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const rel = prefix + entry.name
    if (entry.isDirectory()) return entry.name === '.git' ? [] : listFiles(path.join(dir, entry.name), `${rel}/`)
    return [rel]
  })
  const present = listFiles(root).filter((file) => matchers.some((re) => re.test(file)))
  if (present.length > 0) {
    console.error(`files under ${root} match the managed .gitignore runtime patterns:`)
    for (const file of present) console.error(path.join(root, file))
    process.exit(1)
  }
  console.log(`[ok] no file under ${root} matches ${patterns.length} managed runtime patterns`)
  process.exit(0)
}

const submodules = execFileSync('git', ['config', '--file', '.gitmodules', '--get-regexp', '^submodule\\..*\\.path$'], { encoding: 'utf8' })
  .trim()
  .split('\n')
  .filter(Boolean)
  .map((line) => line.split(' ')[1])
const repos = ['.', ...submodules]

const offenders = []
for (const repo of repos) {
  if (repo !== '.' && readdirSync(repo).length === 0) {
    console.error(`${repo} is not checked out; run git submodule update --init first`)
    process.exit(2)
  }
  const tracked = execFileSync('git', ['-C', repo, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 1 << 28 })
    .split('\0')
    .filter(Boolean)
  for (const file of tracked) {
    if (matchers.some((re) => re.test(file))) offenders.push(path.join(repo, file))
  }
}

if (offenders.length > 0) {
  console.error('tracked files match the managed .gitignore runtime patterns; untrack them with git rm --cached:')
  for (const offender of offenders) console.error(offender)
  process.exit(1)
}
console.log(`[ok] no tracked file matches ${patterns.length} managed runtime patterns in ${repos.length} repos`)
