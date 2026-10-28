// Fallback store for working without MongoDB: the same interface, kept in memory and saved to a JSON file.
// Supports the small subset of Mongo filters the API uses: equality, $gt/$gte/$lt/$lte, $ne, $in, $nin.
import fs from 'node:fs/promises';
import path from 'node:path';
import { objectId } from '../lib/ids.js';

function matchValue(value, cond) {
  if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
    return Object.entries(cond).every(([op, x]) => {
      switch (op) {
        case '$gt': return value > x;
        case '$gte': return value >= x;
        case '$lt': return value < x;
        case '$lte': return value <= x;
        case '$ne': return value !== x;
        case '$in': return x.includes(value);
        case '$nin': return !x.includes(value);
        default: throw new Error(`Unsupported filter operator ${op}`);
      }
    });
  }
  return value === cond || (cond === null && value === undefined);
}

const matches = (doc, filter) => Object.entries(filter).every(([key, cond]) => matchValue(doc[key], cond));

function sorted(docs, sort) {
  if (!sort) return docs;
  const [[key, dir]] = Object.entries(sort);
  return [...docs].sort((a, b) => (a[key] > b[key] ? dir : a[key] < b[key] ? -dir : 0));
}

export async function createFileStore(file) {
  let data = {};
  try {
    data = JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  let timer = null;
  let writing = Promise.resolve();
  const write = () => {
    writing = writing.then(async () => {
      await fs.mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(data));
      await fs.rename(tmp, file);
    }).catch(err => console.error(`Could not save ${file}: ${err.message}`));
    return writing;
  };
  const save = () => {
    clearTimeout(timer);
    timer = setTimeout(write, 200);
  };

  const col = name => (data[name] ||= []);
  const copy = value => structuredClone(value);
  const apply = (doc, set, push) => {
    Object.assign(doc, copy(set));
    for (const [field, item] of Object.entries(push || {})) doc[field] = [...(doc[field] || []), copy(item)];
    save();
    return copy(doc);
  };

  return {
    kind: 'file',
    label: `JSON file (${path.relative(process.cwd(), file) || file})`,

    async find(name, filter = {}, { sort, limit } = {}) {
      const found = sorted(col(name).filter(d => matches(d, filter)), sort);
      return copy(limit ? found.slice(0, limit) : found);
    },
    async findOne(name, filter = {}) {
      return copy(col(name).find(d => matches(d, filter)) ?? null);
    },
    async findById(name, id) {
      return copy(col(name).find(d => d._id === id) ?? null);
    },
    async insert(name, doc) {
      const d = { ...copy(doc), _id: doc._id ?? objectId() };
      col(name).push(d);
      save();
      return copy(d);
    },
    async insertMany(name, docs) {
      col(name).push(...copy(docs).map(d => ({ ...d, _id: d._id ?? objectId() })));
      save();
    },
    async update(name, id, set = {}, { push } = {}) {
      const doc = col(name).find(d => d._id === id);
      return doc ? apply(doc, set, push) : null;
    },
    async updateWhere(name, filter, set = {}, { push } = {}) {
      const doc = col(name).find(d => matches(d, filter));
      return doc ? apply(doc, set, push) : null;
    },
    async updateMany(name, filter, set) {
      let n = 0;
      for (const doc of col(name)) if (matches(doc, filter)) { Object.assign(doc, copy(set)); n++; }
      if (n) save();
      return n;
    },
    async removeMany(name, filter) {
      const before = col(name).length;
      data[name] = col(name).filter(d => !matches(d, filter));
      const n = before - data[name].length;
      if (n) save();
      return n;
    },
    async count(name, filter = {}) {
      return col(name).filter(d => matches(d, filter)).length;
    },
    async ensureIndexes() {},
    async close() {
      clearTimeout(timer);
      await write();
    },
  };
}
