// 创作模板与「全部能力」的场景分组。「今天」页和 AI 创作页共用。

export interface Template {
  id: string;
  emoji: string;
  label: string;
  desc: string;
  /** 填进输入框的开头，用户接着写主题 */
  text: string;
}

export const TEMPLATES: Template[] = [
  { id: 'xhs', emoji: '📕', label: '小红书图文', desc: '一篇笔记 + 6 张卡片，标题和话题都配好', text: '帮我写一篇小红书图文笔记，配 6 张卡片。主题是：' },
  { id: 'cards', emoji: '🗂', label: '知识卡片', desc: '把一段内容拆成一组好读的卡片', text: '把下面这段内容做成一组知识卡片：\n' },
  { id: 'video', emoji: '🎬', label: '一键出短视频', desc: '脚本、配音、字幕、画面，一次做完', text: '帮我做一条 60 秒的竖屏短视频，主题是：' },
  { id: 'script', emoji: '🎙', label: '口播脚本', desc: '开头 3 秒抓人，适合自己出镜念', text: '帮我写一条 60 秒的口播脚本，开头要抓人。主题是：' },
  { id: 'gzh', emoji: '📰', label: '公众号文章', desc: '长文写好并排版，复制就能发', text: '帮我写一篇公众号文章并排好版，主题是：' },
  { id: 'breakdown', emoji: '🔍', label: '拆解爆款', desc: '贴个链接，看它为什么火、你怎么借鉴', text: '帮我拆解这条爆款，说说它为什么火、我能怎么借鉴：' },
];

export interface Scenario {
  id: string;
  emoji: string;
  label: string;
  desc: string;
}

export const SCENARIOS: Scenario[] = [
  { id: 'xhs', emoji: '📕', label: '图文与卡片', desc: '小红书笔记、卡片、海报、信息图' },
  { id: 'video', emoji: '🎬', label: '短视频', desc: '脚本、剪辑、字幕、切片' },
  { id: 'write', emoji: '✍️', label: '文案与长文', desc: '种草文案、公众号、润色改写' },
  { id: 'image', emoji: '🖼', label: '图片处理', desc: 'AI 生图、抠图、修图、图表' },
  { id: 'audio', emoji: '🎧', label: '配音与音乐', desc: '配音、声音克隆、BGM、降噪' },
  { id: 'plan', emoji: '💡', label: '选题与策划', desc: '热点、选题、排期、活动方案' },
  { id: 'publish', emoji: '🚀', label: '发布与检查', desc: '一键多平台、发布前检查' },
  { id: 'data', emoji: '📈', label: '数据与复盘', desc: '账号诊断、评论洞察、复盘' },
  { id: 'persona', emoji: '🧭', label: '账号定位', desc: '人设、受众、差异化定位' },
  { id: 'other', emoji: '🧰', label: '其他工具', desc: '批量处理、素材整理等' },
];

const SCENARIO_OF: Record<string, string> = {};
const put = (scenario: string, ids: string) => ids.split(/\s+/).filter(Boolean).forEach((id) => { SCENARIO_OF[id] = scenario; });

put('xhs', `xhs-note-creator card-xiaohongshu card-design card-quote comparison-card infographic poster-hero
  meme-generator post-formatter skill-carousel-planner`);
put('video', `auto-short-video ai-video-gen video-production video-script video-strategy slideshow-video beat-sync-video short-drama video-editing
  video-highlights clipify video-reframe video-intro-outro video-chapters auto-subtitle subtitle-translate
  green-screen video-to-article`);
put('write', `copywriting social-content text-polisher style-transfer text-condenser skill-article-outline gzh-design
  novel-writer paper-explainer skill-zhihu-answer skill-hook-generator doc-convert mindmap`);
put('image', 'ai-image-gen image-editing image-enhance remove-bg ecom-details-image chart-visualization data-report');
put('audio', 'tts-voiceover voice-clone multi-voice-dubbing ai-music audio-editing audio-mix audio-denoise audio-visualizer');
put('plan', `skill-trending-topics skill-trend-rider skill-topic-evaluator skill-content-matrix skill-content-calendar
  skill-event-calendar skill-campaign-planner skill-livestream skill-content-strategy skill-news-intelligence
  skill-rss-aggregator skill-algorithm-updates skill-content-gap-analysis skill-competitor-analysis
  skill-xhs-analyzer skill-ugc-discovery skill-collab-proposal`);
put('publish', `skill-xhs-publisher skill-douyin-upload skill-kuaishou-upload skill-bilibili-upload skill-channels-upload
  skill-wechat-publisher skill-zhihu-publisher skill-cross-platform-publish skill-publish-scheduler
  skill-publish-checklist skill-publish-log skill-publish-notify skill-content-repurposing skill-cross-platform-diff
  skill-short-link skill-quality-gate skill-risk-scanner skill-seo-quality skill-post-scorer skill-persona-check`);
put('data', `skill-data-tracker skill-publish-analytics skill-content-postmortem skill-social-performance-review
  skill-strategy-advisor skill-account-diagnosis skill-my-account skill-comment-insights skill-community-ops
  skill-xhs-comment-reply roi-calculator`);
put('persona', `skill-profile-builder skill-profile-manager skill-audience-profiler skill-positioning-analysis
  skill-voice-builder skill-brand-onboarding`);

/** 按技能 ID 找场景；新增的技能先按上游的分层归类 */
export function scenarioOf(skill: string, layer?: string): string {
  if (SCENARIO_OF[skill]) return SCENARIO_OF[skill];
  if (layer === 'discover' || layer === 'plan') return 'plan';
  if (layer === 'publish') return 'publish';
  if (layer === 'attribute') return 'data';
  return 'other';
}
