const API_BASE = process.env.NEWS_API_BASE || 'https://60s.2173781196.workers.dev'
const WXPUSHER_APP_TOKEN = process.env.WXPUSHER_APP_TOKEN
const WXPUSHER_UIDS = process.env.WXPUSHER_UIDS || ''
const WXPUSHER_TOPIC_IDS = process.env.WXPUSHER_TOPIC_IDS || ''
/** 设为 0 时去掉正文里的 <img>，只保留链接 */
const WXPUSHER_EMBED_IMAGE = process.env.WXPUSHER_EMBED_IMAGE !== '0'

if (!WXPUSHER_APP_TOKEN) {
  throw new Error('Missing env: WXPUSHER_APP_TOKEN')
}

if (!WXPUSHER_UIDS && !WXPUSHER_TOPIC_IDS) {
  throw new Error('Missing receiver: set WXPUSHER_UIDS or WXPUSHER_TOPIC_IDS')
}

function parseCsv(value) {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

function cacheBustQuery() {
  return `force-update&_=${Date.now()}`
}

function withBustOnUrl(url, bustValue) {
  if (!url || !url.startsWith('http')) return url
  const sep = url.includes('?') ? '&' : '?'
  return `${url}${sep}_=${bustValue}`
}

/** 直连图床（接口 JSON 里的 image），浏览器/微信里通常比 worker 二进制代理更稳 */
function resolveImageUrls(news, bust) {
  const t = Date.now()
  const direct = typeof news.image === 'string' && news.image.startsWith('http') ? news.image : ''
  const viaRedirect = `${API_BASE}/v2/60s?encoding=image&${bust}`
  const viaProxy = `${API_BASE}/v2/60s?encoding=image-proxy&${bust}`

  return {
    /** 内嵌 <img>：优先直连 + 时间戳防缓存 */
    embedSrc: direct ? withBustOnUrl(direct, t) : viaProxy,
    /** 用户点击「在浏览器打开」：直连优先，否则走 API 302 到图床 */
    browserHref: direct ? withBustOnUrl(direct, t) : viaRedirect,
    /** 备用：代理直出 */
    proxyHref: viaProxy,
  }
}

async function getDailyNews() {
  const url = `${API_BASE}/v2/60s?${cacheBustQuery()}`
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  })

  if (!res.ok) {
    throw new Error(`Fetch news failed: ${res.status} ${res.statusText}`)
  }

  const json = await res.json()
  if (!json?.data?.date) {
    throw new Error('Unexpected news payload')
  }
  return json.data
}

async function pushToWxPusher(content, summary) {
  const body = {
    appToken: WXPUSHER_APP_TOKEN,
    contentType: 2,
    summary,
    topicIds: parseCsv(WXPUSHER_TOPIC_IDS).map((v) => Number(v)).filter((n) => Number.isFinite(n)),
    uids: parseCsv(WXPUSHER_UIDS),
    content,
  }

  const res = await fetch('https://wxpusher.zjiecode.com/api/send/message', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  const data = await res.json()
  if (!res.ok || data?.code !== 1000) {
    throw new Error(`WxPusher push failed: ${JSON.stringify(data)}`)
  }

  return data
}

function buildHtml(news) {
  const bust = cacheBustQuery()
  const { embedSrc, browserHref, proxyHref } = resolveImageUrls(news, bust)
  const dateText = news.day_of_week ? `${news.date} ${news.day_of_week}` : news.date
  const textUrl = `${API_BASE}/v2/60s?encoding=text&${bust}`
  const sourceUrl = news.link || `${API_BASE}/v2/60s?${bust}`

  const embedImg = WXPUSHER_EMBED_IMAGE
    ? `<p><img src="${embedSrc}" alt="每天60秒 ${news.date}" referrerpolicy="no-referrer" style="max-width:100%;height:auto;" /></p>`
    : ''

  return `
<h2>📰 每天60秒看世界（${dateText}）</h2>
<p><strong><a href="${browserHref}" target="_blank" rel="noopener noreferrer">浏览器打开今日图片</a></strong></p>
${embedImg}
<p><a href="${proxyHref}" target="_blank" rel="noopener noreferrer">备用：API 图片代理</a></p>
<p>${news.tip || ''}</p>
<p>
  <a href="${textUrl}" target="_blank" rel="noopener noreferrer">文本版</a> |
  <a href="${sourceUrl}" target="_blank" rel="noopener noreferrer">原文来源</a>
</p>
<p><small>图片地址（可复制）：<br/>${browserHref}</small></p>
`.trim()
}

async function main() {
  const news = await getDailyNews()
  const content = buildHtml(news)
  const summary = `每天60秒 · ${news.date}`
  const result = await pushToWxPusher(content, summary)

  console.log('Push success:', {
    message: result.msg,
    data: result.data,
    date: news.date,
    embedImage: WXPUSHER_EMBED_IMAGE,
  })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
