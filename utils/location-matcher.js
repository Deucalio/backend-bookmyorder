const { distance } = require('fastest-levenshtein');
const prisma = require('./prisma');

const normalize = (s) =>
  (s ?? '').toLowerCase().trim().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ');

async function matchLocation(addr) {
  const provinceName = normalize(addr.province);
  const cityName = normalize(addr.city);
  const fullText = normalize(`${addr.address1 ?? ''} ${addr.address2 ?? ''}`);

  const province = provinceName
    ? await prisma.province.findFirst({
        where: { name: { equals: addr.province ?? '', mode: 'insensitive' } },
      })
    : null;

  let city = cityName
    ? await prisma.city.findFirst({
        where: {
          name: { equals: addr.city ?? '', mode: 'insensitive' },
          ...(province && { provinceId: province.id }),
        },
      })
    : null;

  if (!city && cityName) {
    const candidates = await prisma.city.findMany({
      where: province ? { provinceId: province.id } : undefined,
      select: { id: true, name: true, provinceId: true, aliases: true },
    });

    const calculateScore = (str1, str2) => {
      const d = distance(str1, str2);
      const maxLen = Math.max(str1.length, str2.length);
      if (maxLen === 0) return 100;
      return Math.round((1 - d / maxLen) * 100);
    };

    let best = null;
    for (const c of candidates) {
      const candidateNorms = [c.name, ...(c.aliases ?? [])].map(normalize);
      for (const n of candidateNorms) {
        if (n.length < 3) continue;
        const score = calculateScore(cityName, n);
        if (score >= 80 && (!best || score > best.score)) {
          best = { id: c.id, name: c.name, provinceId: c.provinceId, score };
        }
      }
    }
    if (best) {
      city = (await prisma.city.findUnique({ where: { id: best.id } })) ?? city;
    }
  }

  let area = null;
  if (city) {
    const areas = await prisma.area.findMany({ where: { cityId: city.id } });
    area = areas.find((a) => fullText.includes(normalize(a.name))) ?? null;
  }

  return {
    provinceId: province?.id ?? null,
    cityId: city?.id ?? null,
    areaId: area?.id ?? null,
  };
}

module.exports = { matchLocation };
