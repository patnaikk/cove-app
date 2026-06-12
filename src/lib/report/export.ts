import { Capacitor } from '@capacitor/core';
import { todayISO } from '$lib/ui/format';

// Export a text file. On device, write it to the cache and open the iOS share
// sheet (Save to Files, AirDrop, Mail, Print…). In the browser, fall back to a
// Blob download. Resolves false when the user dismissed the share sheet without
// picking a destination — a deliberate choice, not a failure.
export async function downloadText(
	filename: string,
	text: string,
	mime = 'text/plain'
): Promise<boolean> {
	if (Capacitor.isNativePlatform()) {
		const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
		const { Share } = await import('@capacitor/share');
		await Filesystem.writeFile({
			path: filename,
			data: text,
			directory: Directory.Cache,
			encoding: Encoding.UTF8
		});
		const { uri } = await Filesystem.getUri({ path: filename, directory: Directory.Cache });
		try {
			await Share.share({ title: filename, url: uri });
		} catch (e) {
			// @capacitor/share rejects when the sheet is dismissed — that's a cancel.
			if (String((e as Error)?.message ?? '').toLowerCase().includes('cancel')) return false;
			throw e;
		}
		return true;
	}
	const blob = new Blob([text], { type: `${mime};charset=utf-8` });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	a.remove();
	URL.revokeObjectURL(url);
	return true;
}

// All print styles with fully resolved colour values — no CSS variables,
// no dependency on the app's token system.
const PRINT_CSS = `
*,*::before,*::after{box-sizing:border-box}
body{margin:0;padding:20px;background:#fff;font-family:-apple-system,'SF Pro Text','Helvetica Neue',Arial,sans-serif;font-size:10pt;line-height:1.5;color:#1a1a1a}
@page{margin:16mm 18mm}

.pd-head{display:flex;justify-content:space-between;align-items:flex-end;gap:20px;padding-bottom:14px;border-bottom:3px solid #3e5c50}
.pd-brand{font-size:7pt;font-weight:800;text-transform:uppercase;letter-spacing:.18em;color:#3e5c50;margin:0 0 5px}
.pd-titleblock h1{font-size:22pt;font-weight:700;letter-spacing:-.5px;line-height:1.1;color:#111;margin:0 0 5px}
.pd-meta{font-size:8.5pt;color:#777;margin:0;line-height:1.4}
.pd-patient{display:flex;flex-direction:column;gap:11px;min-width:200px;padding-bottom:2px}
.pd-field{display:flex;align-items:baseline;gap:7px;font-size:7.5pt;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:#999;white-space:nowrap}
.pd-rule{flex:1;border-bottom:1px solid #bbb;height:0;min-width:80px}

.pd-section{margin-top:22px;break-inside:avoid}
.pd-section h2{font-size:7pt;font-weight:800;text-transform:uppercase;letter-spacing:.12em;color:#3e5c50;margin:0 0 10px;padding-bottom:5px;border-bottom:1.5px solid #3e5c50}
.pd-flag-scope{font-weight:600;text-transform:none;letter-spacing:0;color:#aaa;font-size:6.5pt}
.pd-group-head{font-size:9.5pt;font-weight:700;color:#333;margin:18px 0 6px;padding:0;border:none}

.pd-stats{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid #c5dbd3;border-radius:5px;overflow:hidden;background:#f2f7f5}
.pd-stat{padding:14px 15px 12px;border-right:1px solid #c5dbd3;display:flex;flex-direction:column}
.pd-stat-edge{border-right:none}
.pd-stat-label{font-size:6.5pt;font-weight:800;text-transform:uppercase;letter-spacing:.09em;color:#3e5c50;margin-bottom:5px}
.pd-stat-big{font-size:22pt;font-weight:700;letter-spacing:-.5px;line-height:1;color:#111}
.pd-stat-unit{font-size:9pt;font-weight:400;color:#777;letter-spacing:0}
.pd-stat-date{font-size:11pt;font-weight:700;color:#111;line-height:1.2}
.pd-stat-nil{font-size:20pt;font-weight:300;color:#ccc;line-height:1}
.pd-stat-sub{font-size:7.5pt;color:#888;margin-top:4px}
.pd-reg{font-size:11.5pt;font-weight:700;line-height:1.2}
.pd-reg-regular{color:#2a6647}
.pd-reg-irregular{color:#8c3520}
.pd-reg-insufficient{color:#888;font-size:10pt;font-weight:600}
.pd-bleed-note{margin:8px 0 0;font-size:7.5pt;color:#999;font-style:italic}

.pd-callout{border-left:3.5px solid #b06a38;background:#fdf4ee;padding:11px 16px;break-inside:avoid}
.pd-flags{margin:0;padding-left:0;list-style:none}
.pd-flags li{font-size:10pt;color:#1f0f08;line-height:1.55;padding:3px 0 3px 18px;position:relative}
.pd-flags li::before{content:'▸';position:absolute;left:0;top:4px;color:#b06a38;font-size:8pt}

.pd-table{width:100%;border-collapse:collapse;font-size:9.5pt;margin-top:2px}
.pd-table thead{display:table-header-group}
.pd-table th{text-align:left;font-size:7pt;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:#666;border-bottom:1.5px solid #3e5c50;padding:5px 10px 5px 0}
.pd-table td{padding:6px 10px 6px 0;border-bottom:1px solid #e6ede8;color:#222;vertical-align:top}
.pd-table th.num,.pd-table td.num{text-align:right;padding-right:0;padding-left:14px}
.pd-table tr{break-inside:avoid}
.pd-zebra tbody tr:nth-child(even) td{background:#f5faf6}
.pd-sev{font-weight:700}
.pd-sev-1{color:#666;font-weight:600}
.pd-sev-2{color:#7a5520}
.pd-sev-3{color:#8c3520}
.pd-excluded td{color:#bbb}
.pd-ex-tag{display:inline-block;margin-left:8px;font-size:6.5pt;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:#ccc;text-decoration:none;vertical-align:middle}
.pd-narrow{max-width:280px}

.pd-wellbeing{display:grid;grid-template-columns:1fr 1fr;gap:28px;break-inside:avoid}
.pd-wellbeing .pd-section{margin-top:22px}
.pd-wkey{font-size:7.5pt;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#999;padding-right:14px!important;width:22%;vertical-align:top}

.pd-note-date{white-space:nowrap;width:1%;padding-right:18px!important;color:#777;font-size:9pt}

.pd-foot{margin-top:36px;padding-top:10px;border-top:1px solid #ddd;font-size:7.5pt;line-height:1.55;color:#aaa}
.pd-running{display:none}
`;

// Generate a real PDF from the .print-doc element using the native PDF renderer
// (@capgo/capacitor-pdf-generator → iOS WKWebView → PDFKit), then share it via
// the iOS share sheet as a .pdf file. User taps "Save to Files" and gets a PDF.
//
// Falls back to window.print() in the browser dev environment.
export async function printReport(): Promise<void> {
	if (Capacitor.isNativePlatform()) {
		const printDoc = document.querySelector('.print-doc');
		if (!printDoc) throw new Error('[cove] .print-doc not found in DOM');

		const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Cove Health Report</title>
<style>${PRINT_CSS}</style>
</head>
<body>${printDoc.innerHTML}</body>
</html>`;

		// Use the plugin's 'share' mode — it renders the PDF natively, writes it to
		// a temp file, and opens the iOS share sheet in one call. No manual Filesystem
		// dance, no base64 type-narrowing, no extra @capacitor/share call needed.
		const { PdfGenerator } = await import('@capgo/capacitor-pdf-generator');
		const filename = `cove-report-${todayISO()}.pdf`;
		try {
			await PdfGenerator.fromData({
				data: html,
				documentSize: 'A4',
				orientation: 'portrait',
				type: 'share',
				fileName: filename
			});
		} catch (e) {
			// Dismissing the share sheet is a choice, not a failure — don't surface it.
			if (String((e as Error)?.message ?? '').toLowerCase().includes('cancel')) return;
			throw e;
		}
		return;
	}
	// Browser dev: use window.print() as before.
	window.print();
}
