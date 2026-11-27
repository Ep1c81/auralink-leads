export function authorized(header:string|null,secret:string|undefined):boolean;
export function dispatch(input:{stage:string,store:{preview(stage:string):Promise<unknown[]>},preview?:boolean}):Promise<unknown>;
export function eventInput(input:unknown):Record<string,unknown>;
