// 前端状态镜像（design §4.3 / §4.4 帧渲染优先级）。
// 结构性状态（phase/lang/flower/crimes/members/fortune/burned/roomCode/role）
//   以 room_state 快照为准；
// 高频 hits/villainStage 以 hit/villain_state 增量帧为准，hits 取 Math.max 单调递增防回退。

import { CONFIG } from './config.js';

export class Store {
  constructor() {
    this.state = {
      roomCode: null,
      role: null, // victim | shaman
      phase: null, // altar|chanting|beating|burning|fortune
      flower: '',
      crimes: [],
      lang: null,
      hits: 0,
      target: CONFIG.TARGET_HITS,
      villainStage: '嚣张',
      burned: false,
      fortune: null,
      members: [],
      connected: false,
    };
    this.listeners = new Set();
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  _emit(reason) {
    for (const fn of this.listeners) {
      try {
        fn(this.state, reason);
      } catch (e) {
        console.error(e);
      }
    }
  }

  get phase() {
    return this.state.phase;
  }

  /** 应用后端快照（结构性状态为准；hits 用 Math.max 合并，不倒退）。 */
  applySnapshot(snapshot, extra = {}) {
    if (!snapshot) return;
    const s = this.state;
    s.roomCode = snapshot.roomCode ?? s.roomCode;
    s.phase = snapshot.phase ?? s.phase;
    s.flower = snapshot.flower ?? s.flower;
    s.crimes = Array.isArray(snapshot.crimes) ? snapshot.crimes : s.crimes;
    s.lang = snapshot.lang ?? null;
    s.target = snapshot.target ?? s.target;
    s.burned = !!snapshot.burned;
    s.fortune = snapshot.fortune ?? s.fortune;
    s.members = Array.isArray(snapshot.members) ? snapshot.members : s.members;
    // hits 单调递增
    if (typeof snapshot.hits === 'number') s.hits = Math.max(s.hits, snapshot.hits);
    // villainStage 结构帧也更新（但以阶段阈值对齐权威 hits）
    if (snapshot.villainStage) s.villainStage = snapshot.villainStage;
    if (extra.role) s.role = extra.role;
    // 自身角色：从 members 中 isSelf 推断（若快照含）
    const self = (snapshot.members || []).find((m) => m.isSelf);
    if (self && self.role) s.role = self.role;
    this._emit('snapshot');
  }

  /** 应用 hit 增量帧：hits 单调递增，更新阶段。 */
  applyHit({ hits, villainStage }) {
    const s = this.state;
    if (typeof hits === 'number') s.hits = Math.max(s.hits, hits);
    if (villainStage) s.villainStage = villainStage;
    this._emit('hit');
  }

  /** villain_state：仅用于跨阶段一次性特效触发，这里同步阶段字段。 */
  applyVillainState({ villainStage, hits }) {
    const s = this.state;
    if (typeof hits === 'number') s.hits = Math.max(s.hits, hits);
    if (villainStage) s.villainStage = villainStage;
    this._emit('villain_state');
  }

  applyFortune(fortune) {
    this.state.fortune = fortune;
    this._emit('fortune');
  }

  setBurned() {
    this.state.burned = true;
    this._emit('burn');
  }

  setMembers(members) {
    if (Array.isArray(members)) this.state.members = members;
    const self = (members || []).find((m) => m.isSelf);
    if (self && self.role) this.state.role = self.role;
    this._emit('members');
  }

  setConnected(v) {
    this.state.connected = !!v;
    this._emit('connected');
  }
}
