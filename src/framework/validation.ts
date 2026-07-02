/** Framework-level required-field helpers (not site-specific). */

export const REQUIRED_FIELDS_ERROR_PREFIX = '必填项未填写：';

export function buildRequiredFieldsError(labels: string[]): string {
  return `${REQUIRED_FIELDS_ERROR_PREFIX}${labels.join('、')}`;
}

export function parseMissingRequiredFields(message: string): string[] | null {
  const trimmed = message.trim();
  if (!trimmed.startsWith(REQUIRED_FIELDS_ERROR_PREFIX)) return null;
  const rest = trimmed.slice(REQUIRED_FIELDS_ERROR_PREFIX.length).trim();
  if (!rest) return null;
  const fields = rest.split(/[、,，]/).map((s) => s.trim()).filter(Boolean);
  return fields.length ? fields : null;
}

export function formatRequiredFieldQuestion(fields: string[]): string {
  if (fields.length === 1) {
    return `提交前发现还缺少必填项「${fields[0]}」。请告诉我应填写什么内容，我会在表单中补全后继续提交。`;
  }
  return `提交前发现还缺少以下必填项：${fields.map((f) => `「${f}」`).join('、')}。请告诉我各项应填写什么内容，我会在表单中补全后继续提交。`;
}
