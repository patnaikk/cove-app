import { Capacitor } from '@capacitor/core';

// Export a text file. On device, write it to the cache and open the iOS share
// sheet (Save to Files, AirDrop, Mail…). In the browser, fall back to a Blob
// download. Returns a promise so callers can surface failures.
export async function downloadText(
	filename: string,
	text: string,
	mime = 'text/plain'
): Promise<void> {
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
		await Share.share({ title: filename, url: uri });
		return;
	}

	// Browser dev path: Blob download.
	const blob = new Blob([text], { type: `${mime};charset=utf-8` });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	a.remove();
	URL.revokeObjectURL(url);
}

// The PDF "report" is the print stylesheet sent to the system print dialog.
// In WKWebView this surfaces the iOS print / share sheet (Save to Files as PDF).
export function printReport(): void {
	window.print();
}
