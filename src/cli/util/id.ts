import crypto from "crypto";

const ID_SYMBOLS = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const ID_SYMBOLS_BASE = BigInt(ID_SYMBOLS.length);

export function createStringId() {
  return uuidToString(crypto.randomUUID());
}

export function uuidToString(uuid: string) {
  const uuidWithoutHyphens = uuid.replace(/-/g, '');

  let number = BigInt('0x' + uuidWithoutHyphens);
  let result = '';
  do {
    const [ quotient, remainder ] = [ number / ID_SYMBOLS_BASE, Number(number % ID_SYMBOLS_BASE) ];
    result = ID_SYMBOLS.charAt( remainder ) + result;
    number = quotient;
  } while(number > 0n);

  return result;
}
