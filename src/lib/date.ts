// Posts declare `date` as a plain YYYY-MM-DD, which the schema's z.coerce.date()
// parses as UTC midnight. Formatting that instant without pinning the time zone
// renders the *previous* day for any reader west of UTC — 2026-09-11 shows as
// "Sep 10, 2026" in America/New_York. Every post date is formatted through here
// so the UTC pin can't be forgotten at a call site.
export function formatPostDate(date: Date): string {
	return date.toLocaleDateString('en-US', {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
		timeZone: 'UTC',
	});
}
