// Undo / redo by snapshots. The page tells it "something changed" (touch); once changes stop for a
// moment it takes a snapshot, so a drag or a stretch of typing is one undo step, not hundreds.
// Snapshots are strings (JSON of the whole project), so comparing two is a string comparison.

export class History {
  /**
   * snapshot()   -> string: the project as it is now
   * restore(s)   applies a snapshot to the page
   * onCommit(s)  every time a new snapshot is kept (the page autosaves here)
   */
  constructor({ snapshot, restore, onCommit, limit = 200, settleMs = 400 }) {
    Object.assign(this, { snapshot, restore, onCommit, limit, settleMs });
    this.stack = [snapshot()];
    this.at = 0;
    this.timer = null;
  }

  get canUndo() { return this.pending() || this.at > 0; }
  get canRedo() { return !this.pending() && this.at < this.stack.length - 1; }
  pending() { return this.snapshot() !== this.stack[this.at]; }

  /** Something changed: keep a snapshot once it has been quiet for a moment. */
  touch() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.commit(), this.settleMs);
  }

  /** Keep a snapshot now, if anything changed since the last one. */
  commit() {
    clearTimeout(this.timer);
    this.timer = null;
    const s = this.snapshot();
    if (s === this.stack[this.at]) return false;
    this.stack.splice(this.at + 1); // a new edit ends the redo trail
    this.stack.push(s);
    if (this.stack.length > this.limit) this.stack.shift();
    this.at = this.stack.length - 1;
    this.onCommit?.(s);
    return true;
  }

  undo() {
    this.commit();
    if (this.at === 0) return false;
    this.restore(this.stack[--this.at]);
    return true;
  }

  redo() {
    this.commit();
    if (this.at >= this.stack.length - 1) return false;
    this.restore(this.stack[++this.at]);
    return true;
  }
}
