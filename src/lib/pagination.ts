export function pageNumber(value: unknown): number {
 const page=Number(value ?? 0);
 return Number.isInteger(page)&&page>=0&&page<=10000?page:0;
}
