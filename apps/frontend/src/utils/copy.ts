export async function copyToClipboard(value: string): Promise<boolean> {
  if (typeof value !== 'string') {
    return false;
  }
  if (typeof navigator === 'undefined') {
    return false;
  }
  const text = value;
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (error) {
    console.warn('Failed to write text via clipboard API.', error);
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.left = '-1000px';
    textarea.style.top = '-1000px';
    document.body.appendChild(textarea);
    textarea.select();
    const succeeded = document.execCommand('copy');
    document.body.removeChild(textarea);
    return succeeded;
  } catch (error) {
    console.warn('Fallback clipboard copy failed.', error);
    return false;
  }
}
