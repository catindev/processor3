function checksum10(inn10) {
  const d = inn10.split('').map(Number);
  const w = [2, 4, 10, 3, 5, 9, 4, 6, 8];
  let s = 0;
  for (let i = 0; i < 9; i += 1) s += w[i] * d[i];
  return (s % 11) % 10;
}

function checksum11(inn12) {
  const d = inn12.split('').map(Number);
  const w = [7, 2, 4, 10, 3, 5, 9, 4, 6, 8, 0];
  let s = 0;
  for (let i = 0; i < 11; i += 1) s += w[i] * d[i];
  return (s % 11) % 10;
}

function checksum12(inn12) {
  const d = inn12.split('').map(Number);
  const w = [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8, 0];
  let s = 0;
  for (let i = 0; i < 11; i += 1) s += w[i] * d[i];
  return (s % 11) % 10;
}

function validInn(rule, ctx) {
  try {
    const got = ctx.get(rule.field);
    if (!got.ok) return { status: 'FAIL' };
    const inn = String(got.value ?? '');
    if (!/^\d+$/.test(inn)) return { status: 'FAIL' };
    if (inn.length === 10) return { status: checksum10(inn) === Number(inn[9]) ? 'OK' : 'FAIL' };
    if (inn.length === 12) {
      const c11 = checksum11(inn);
      const c12 = checksum12(inn);
      return { status: c11 === Number(inn[10]) && c12 === Number(inn[11]) ? 'OK' : 'FAIL' };
    }
    return { status: 'FAIL' };
  } catch (error) {
    return { status: 'EXCEPTION', error };
  }
}

function validOgrn(rule, ctx) {
  try {
    const got = ctx.get(rule.field);
    if (!got.ok) return { status: 'FAIL' };
    const s = String(got.value ?? '');
    if (!/^\d+$/.test(s)) return { status: 'FAIL' };
    if (s.length === 13) {
      const n = BigInt(s.slice(0, 12));
      const cd = Number((n % 11n) % 10n);
      return { status: cd === Number(s[12]) ? 'OK' : 'FAIL' };
    }
    if (s.length === 15) {
      const n = BigInt(s.slice(0, 14));
      const cd = Number((n % 13n) % 10n);
      return { status: cd === Number(s[14]) ? 'OK' : 'FAIL' };
    }
    return { status: 'FAIL' };
  } catch (error) {
    return { status: 'EXCEPTION', error };
  }
}

export const operatorPacks = {
  'beneficiary-defaults': {
    check: {
      valid_inn: validInn,
      valid_ogrn: validOgrn
    },
    predicate: {},
    meta: {
      operators: {
        valid_inn: { description: 'ИНН корректен по контрольным разрядам' },
        valid_ogrn: { description: 'ОГРН/ОГРНИП корректен по контрольному разряду' }
      }
    }
  }
};
