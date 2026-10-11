// RBAC: vai trò -> quyền theo module. Kiểm tra ở lớp store (mọi thao tác ghi) và UI.
export const ROLES = {
  admin: { name: 'Chủ doanh nghiệp / Admin' },
  ketoan: { name: 'Kế toán / Tài chính' },
  kinhdoanh: { name: 'Kinh doanh' },
  thumua: { name: 'Thu mua' },
  kho: { name: 'Kho / Vận hành' },
  quanlymang: { name: 'Quản lý mảng' },
  xem: { name: 'Chỉ xem' },
};
const V = ['view'], VE = ['view', 'edit'], VEX = ['view', 'edit', 'export'], VX = ['view', 'export'];
export const PERMS = {
  admin: '*',
  ketoan: { dashboard: V, cashflow: VEX, ar: VEX, ap: VEX, profit: VX, sales: V, purchase: V, inventory: V, budget: VEX, coffee: V, ops: V, scenario: VE, ai: V, reports: VX, approvals: ['view', 'approve'], audit: V },
  kinhdoanh: { dashboard: V, sales: VE, ar: VE, profit: V, inventory: V, ai: V, approvals: V, reports: V },
  thumua: { dashboard: V, purchase: VE, coffee: VE, ap: V, inventory: V, approvals: V },
  kho: { inventory: VE, purchase: V, approvals: V },
  quanlymang: { dashboard: V, profit: VX, sales: V, budget: V, ops: VE, inventory: V, ai: V, scenario: V, reports: VX, approvals: V },
  xem: { dashboard: V, reports: V },
};
export const can = (user, mod, action = 'view') => {
  if (!user) return false;
  const p = PERMS[user.role];
  if (p === '*') return true;
  return !!p?.[mod]?.includes(action);
};
// Phạm vi dữ liệu theo mảng: user.segments = 'all' | [segmentId]
export const inScope = (user, segmentId) => !user || user.segments === 'all' || !segmentId || user.segments?.includes(segmentId);
export class PermissionError extends Error {}
export const assertCan = (user, mod, action) => { if (!can(user, mod, action)) throw new PermissionError(`Không có quyền ${action} ở mục "${mod}"`); };

// ---- Luồng phê duyệt theo số tiền (cấu hình được trong settings.approvalTiers) ----
export function requiredRoles(settings, amount) {
  const tier = [...settings.approvalTiers].sort((a, b) => a.upTo - b.upTo).find((t) => amount <= t.upTo) || settings.approvalTiers.at(-1);
  return tier.roles;
}
export function canApprove(user, approval, settings) {
  if (!can(user, 'approvals', 'approve')) return 'Vai trò không có quyền duyệt';
  if (!requiredRoles(settings, approval.amount).includes(user.role)) return 'Số tiền vượt thẩm quyền của vai trò này';
  if (settings.dualControl && approval.requesterId === user.id) return 'Kiểm soát kép: không tự duyệt giao dịch do mình tạo';
  return null;
}
