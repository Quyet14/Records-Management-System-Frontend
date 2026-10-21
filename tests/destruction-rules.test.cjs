const { test } = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../assets/js/destruction-rules.js');

const now = Date.parse('2026-10-19T03:00:00Z');
const admin = { id: 'admin-2', role: 'admin' };
const head = { id: 'head-1', role: 'department_head' };
const request = (changes = {}) => ({
  createdBy: { id: 'admin-1' }, status: 'pending', version: 1,
  approvals: [], allowedActions: ['approve', 'reject', 'withdraw', 'complete'], ...changes
});
const doc = (changes = {}) => ({
  status: 'stored', retentionUntil: '2026-10-18T03:00:00Z', legalHold: false,
  eligible: true, activeDestructionRequestId: null, ...changes
});

test('user requests require both upload ownership and department; missing identities deny access', () => {
  const actor = { id: 'user-1', role: 'user', departmentId: 'dept-1' };
  const own = { id: 'doc-1', status: 'stored', uploaderId: actor.id, departmentId: actor.departmentId };
  assert.equal(rules.proposalBlockReason(own, actor), '');
  assert.equal(rules.proposalBlockReason({ id: 'doc-1', status: 'stored', uploader: { id: actor.id }, department: { id: actor.departmentId } }, actor), '');
  for (const changes of [{ uploaderId: 'other' }, { departmentId: 'other' }, { uploaderId: null }, { departmentId: null }]) {
    assert.ok(rules.proposalBlockReason({ ...own, ...changes }, actor));
  }
  assert.ok(rules.proposalBlockReason(own, { role: 'user' }));
  assert.equal(rules.canAction(request({ createdBy: actor }), 'withdraw', actor, now), true);
  assert.equal(rules.canAction(request(), 'withdraw', actor, now), false);
  assert.equal(rules.canAction(request({ createdBy: actor, allowedActions: [] }), 'withdraw', actor, now), false);
  assert.equal(rules.canViewRequest(request({ createdBy: actor }), actor), true);
  assert.equal(rules.canViewRequest(request(), actor), false);
  assert.equal(rules.canViewRequest(request({ createdBy: {} }), { role: 'user' }), false);
  for (const action of ['approve', 'reject', 'complete']) {
    assert.equal(rules.canAction(request({ createdBy: actor }), action, actor, now), false);
  }
});

test('eligibility requires expired retention, explicit no-hold and server eligibility', () => {
  assert.equal(rules.eligible(doc(), now), true);
  assert.equal(rules.eligible(doc({ retentionUntil: '2026-10-19T03:00:00Z' }), now), true);
  for (const changes of [
    { retentionUntil: null }, { retentionUntil: 'invalid' }, { retentionUntil: '2026-10-20T00:00:00Z' },
    { legalHold: true }, { legalHold: undefined }, { legalHold: 'false' }, { eligible: false }, { eligible: undefined },
    { status: 'destroyed' }, { status: 'pending' }, { activeDestructionRequestId: 'request-2' }
  ]) assert.equal(rules.eligible(doc(changes), now), false, JSON.stringify(changes));
});

test('approvals allow admins and department heads with explicit server permission', () => {
  assert.equal(rules.canAction(request(), 'approve', admin, now), true);
  assert.equal(rules.canAction(request({ status: 'partially_approved' }), 'approve', admin, now), true);
  for (const changes of [
    { createdBy: { id: admin.id } }, { createdBy: {} }, { allowedActions: [] },
    { allowedActions: undefined }, { version: undefined }, { version: '1' },
    { status: 'scheduled' }, { status: 'destroyed' }, { status: 'completed' },
    { approvals: [{ userId: admin.id }] }
  ]) assert.equal(rules.canAction(request(changes), 'approve', admin, now), false, JSON.stringify(changes));
  assert.equal(rules.canAction(request(), 'approve', head, now), true);
  assert.equal(rules.canAction(request({ allowedActions: ['withdraw'] }), 'approve', head, now), false);
  assert.equal(rules.canAction(request({ createdBy: { id: head.id } }), 'approve', head, now), false);
  assert.equal(rules.canAction(request({ approvals: [{ userId: head.id }] }), 'approve', head, now), false);
  assert.equal(rules.canAction(request(), 'approve', { ...admin, role: 'user' }, now), false);
  assert.equal(rules.canAction(request(), 'approve', null, now), false);
});

test('department head self-approval requires a one-approval request and server ownership permission', () => {
  const own = request({ createdBy: { id: head.id }, requiredApprovals: 1 });
  assert.equal(rules.canAction(own, 'approve', head, now), true);
  for (const changes of [
    { allowedActions: [] }, { allowedActions: ['withdraw'] },
    { requiredApprovals: 2 }, { requiredApprovals: undefined },
    { approvals: [{ userId: head.id }] }, { status: 'scheduled' }
  ]) assert.equal(rules.canAction({ ...own, ...changes }, 'approve', head, now), false, JSON.stringify(changes));
  assert.equal(rules.canAction(request({ createdBy: { id: admin.id }, requiredApprovals: 1 }), 'approve', admin, now), false);
});

test('withdrawal stops at the exact deadline and never applies during processing', () => {
  assert.equal(rules.canAction(request({ status: 'scheduled', executeAfter: '2026-10-19T03:00:01Z' }), 'withdraw', head, now), true);
  for (const executeAfter of ['2026-10-19T03:00:00Z', '2026-10-19T02:59:59Z', null, 'invalid']) {
    assert.equal(rules.canAction(request({ status: 'scheduled', executeAfter }), 'withdraw', head, now), false);
  }
  for (const status of ['processing', 'destroyed', 'completed', 'failed', 'withdrawn', 'rejected']) {
    assert.equal(rules.canAction(request({ status }), 'withdraw', admin, now), false);
  }
  assert.equal(rules.canAction(request({ allowedActions: [] }), 'withdraw', head, now), false);
});

test('only admin can close a request after confirmed destruction', () => {
  assert.equal(rules.canAction(request({ status: 'destroyed' }), 'complete', admin, now), true);
  assert.equal(rules.canAction(request({ status: 'destroyed' }), 'complete', head, now), false);
  for (const status of ['pending', 'partially_approved', 'scheduled', 'processing', 'completed', 'failed']) {
    assert.equal(rules.canAction(request({ status }), 'complete', admin, now), false);
  }
});

test('rejection is available to another authorized admin or department head before scheduling', () => {
  assert.equal(rules.canAction(request(), 'reject', admin, now), true);
  assert.equal(rules.canAction(request(), 'reject', head, now), true);
  assert.equal(rules.canAction(request({ allowedActions: ['withdraw'] }), 'reject', head, now), false);
  assert.equal(rules.canAction(request({ createdBy: { id: head.id } }), 'reject', head, now), false);
  assert.equal(rules.canAction(request({ createdBy: { id: admin.id } }), 'reject', admin, now), false);
  assert.equal(rules.canAction(request({ status: 'scheduled' }), 'reject', admin, now), false);
  assert.equal(rules.canAction(request(), 'delete', admin, now), false);
});
