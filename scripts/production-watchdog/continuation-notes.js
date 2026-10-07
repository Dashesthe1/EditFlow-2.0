'use strict';
const fs = require('fs');
const path = require('path');

function readContinuationNotes(root, task) {
  try {
    const file = path.join(root, 'continuation-notes.json');
    if (fs.statSync(file).size > 32768) return null;
    const note = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (note.assignmentId !== task.assignmentId || note.sessionId !== task.sessionId
      || typeof note.text !== 'string' || note.text.length > 16000 || !note.text.trim()) return null;
    return note.text.trim();
  } catch { return null; }
}
module.exports = { readContinuationNotes };
