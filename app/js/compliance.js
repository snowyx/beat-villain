// 花名真实姓名拦截（design §10 规则 1 / 民俗合规 §1）。
// 纯函数，可被 node:test 直接导入；不触网、不依赖 DOM。
//
// 定位：合规引导而非严格鉴别。宁可偶尔放行也配「一键随机花名」逃生口，不做过度拦截。

// 内置常见姓氏表：约 100 个常见单姓 + 常见复姓。
// 来源为公开《百家姓》常见姓氏，不含任何真实个人信息。
export const COMMON_SURNAMES = Object.freeze([
  // 常见单姓（百家姓前列 + 高频姓）
  '王', '李', '张', '刘', '陈', '杨', '黄', '赵', '吴', '周',
  '徐', '孙', '马', '朱', '胡', '郭', '何', '高', '林', '罗',
  '郑', '梁', '谢', '宋', '唐', '许', '韩', '冯', '邓', '曹',
  '彭', '曾', '肖', '田', '董', '袁', '潘', '于', '蒋', '蔡',
  '余', '杜', '叶', '程', '苏', '魏', '吕', '丁', '任', '沈',
  '姚', '卢', '姜', '崔', '钟', '谭', '陆', '汪', '范', '金',
  '石', '廖', '贾', '夏', '韦', '付', '方', '白', '邹', '孟',
  '熊', '秦', '邱', '江', '尹', '薛', '闫', '段', '雷', '侯',
  '龙', '史', '陶', '黎', '贺', '顾', '毛', '郝', '龚', '邵',
  '万', '钱', '严', '覃', '武', '戴', '莫', '孔', '向', '汤',
  // 常见复姓
  '欧阳', '司马', '上官', '诸葛', '夏侯', '东方', '皇甫', '尉迟',
  '公孙', '慕容', '令狐', '宇文', '长孙', '司徒', '司空',
]);

// 复姓集合（用于优先匹配两字姓）
const COMPOUND_SURNAMES = COMMON_SURNAMES.filter((s) => s.length === 2);
const SINGLE_SURNAMES = new Set(COMMON_SURNAMES.filter((s) => s.length === 1));

// 称谓结尾（姓 + 称谓 → 疑似真名）
const TITLE_SUFFIX = /(先生|女士|小姐|总|老师|经理|主任|医生|律师|同学)$/;

// 花名特征词：命中则一律放行（整活花名逃生）。
// 注意不要收录本身即常见姓氏的单字（如「王」），以免「王女士」「王小明」被误放行。
const PLAYFUL_MARKERS = ['本卷', '某人', '隔壁', '大王', '之光', '达人', '侠', '怪', '精', '魔', '狂'];

const PURE_HAN = /^[\u4e00-\u9fa5]+$/;

/**
 * 判断是否疑似真实姓名。返回 { blocked: boolean, reason?: string }。
 * 规则（design §10 / 民俗合规 §1）：
 *   前置：必填、字符串、trim 后长度 1–12。
 *   1. 2–4 纯汉字 且首字命中姓氏表 → 疑似真名（复姓优先判两字姓）。
 *   2. 姓 + 称谓结尾（前缀 1–2 汉字）→ 疑似。
 *   整活花名 / 非中文 / 含数字符号 / 命中花名特征词 → 放行。
 */
export function checkFlower(raw) {
  if (typeof raw !== 'string') {
    return { blocked: false, reason: 'not-string' };
  }
  const name = raw.trim();
  if (name.length < 1 || name.length > 12) {
    return { blocked: false, reason: 'length-out-of-range' };
  }

  // 花名特征词放行（优先，避免「隔壁组某人」「卷王本卷」被误伤）
  if (PLAYFUL_MARKERS.some((m) => name.includes(m))) {
    return { blocked: false, reason: 'playful-marker' };
  }

  // 规则 2：姓 + 称谓结尾
  if (TITLE_SUFFIX.test(name)) {
    const prefix = name.replace(TITLE_SUFFIX, '');
    if (prefix.length >= 1 && prefix.length <= 2 && PURE_HAN.test(prefix) && hasSurnamePrefix(prefix)) {
      return { blocked: true, reason: 'surname-title' };
    }
  }

  // 规则 1：2–4 纯汉字 且首字命中姓氏表
  if (PURE_HAN.test(name) && name.length >= 2 && name.length <= 4 && hasSurnamePrefix(name)) {
    return { blocked: true, reason: 'surname-name' };
  }

  return { blocked: false, reason: 'ok' };
}

/** 该纯汉字串是否以内置姓氏（复姓优先）开头。 */
function hasSurnamePrefix(str) {
  if (COMPOUND_SURNAMES.some((s) => str.startsWith(s))) return true;
  return SINGLE_SURNAMES.has(str[0]);
}

// 一键随机花名（逃生口）：前缀 + 后缀整活组合，保证放行。
const FLOWER_PREFIX = [
  '甩锅', '卷王', '阴阳', '画饼', '摸鱼', '背锅', '内卷', '已读不回',
  '抢功', '催命', '夺命', '键盘', '躺平', '加班',
];
const FLOWER_SUFFIX = ['侠', '怪', '精', '本卷', '大王', '狂魔', '之光', '达人', '小能手', '鬼才'];

/** 生成一个随机整活花名（必然通过 checkFlower）。 */
export function randomFlower() {
  const p = FLOWER_PREFIX[Math.floor(Math.random() * FLOWER_PREFIX.length)];
  const s = FLOWER_SUFFIX[Math.floor(Math.random() * FLOWER_SUFFIX.length)];
  return p + s;
}
