export function downloadFile(content: string, filename: string, type: string) {
  let url: string | undefined;
  const link = document.createElement('a');
  try {
    url = URL.createObjectURL(new Blob([content], { type }));
    link.href = url; link.download = filename; document.body.append(link); link.click();
  } finally {
    link.remove();
    if (url) { const completed = url; window.setTimeout(() => URL.revokeObjectURL(completed), 1000); }
  }
}
