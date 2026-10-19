/**
 * Protection function library. The catalog is deliberately data-driven: the
 * relay model stores one instance per function, the UI renders the applicable
 * subset, and the evaluation engine uses the declared quantity/check to produce
 * a consistent scheme-level verdict.
 */
const s = (key, label, value, unit = '', min = null, max = null, step = null) => ({ key, label, value, unit, min, max, step });

export const PROTECTION_CATALOG = [
  // ---------------- Line protections ----------------
  {
    id: 'line_distance', code: '21', name: '相间距离保护', category: 'line', group: '主保护', core: true,
    defaultEnabled: true, quantity: 'impedance',
    description: '三段式相间距离保护，按正序阻抗多边形/圆特性切除相间故障，是高压线路的主保护。',
    settings: []
  },
  {
    id: 'line_overcurrent', code: '50/51', name: '阶段式过流保护', category: 'line', group: '后备保护', core: true,
    defaultEnabled: true, quantity: 'current',
    description: '定时限/反时限过流后备保护，按负荷电流与电气深度整定，作为距离保护的后备。',
    settings: []
  },
  {
    id: 'line_reclose', code: '79', name: '自动重合闸', category: 'line', group: '辅助与监视', core: true,
    defaultEnabled: true, quantity: 'status',
    description: '线路跳闸后按整定次数与死区时间自动重合，区分瞬时性与永久性故障。',
    settings: []
  },
  {
    id: 'line_ground_distance', code: '21N', name: '接地距离保护', category: 'line', group: '主保护',
    defaultEnabled: true, quantity: 'impedance',
    description: '带零序补偿的接地距离保护，反映单相/两相接地故障的正序与零序阻抗。',
    settings: [s('z1', 'I 段接地阻抗', 4, 'Ω', 0.01, 500, 0.01), s('k0', '零序补偿系数', 0.67, '', 0, 2, 0.01), s('t1', 'I 段时间', 0, 's', 0, 10, 0.01), s('t2', 'II 段时间', 0.4, 's', 0, 10, 0.01)]
  },
  {
    id: 'line_pilot_differential', code: '87L', name: '线路纵联差动保护', category: 'line', group: '主保护',
    defaultEnabled: true, quantity: 'differential',
    description: '比较线路两端电流相量，瞬时切除全线故障，不受系统振荡与负荷电流影响。',
    settings: [s('pickup', '差动启动值', 0.2, 'Ie', 0.01, 2, 0.01), s('slope', '制动斜率', 0.3, 'pu', 0, 1, 0.01), s('t', '动作时间', 0.02, 's', 0, 1, 0.005)]
  },
  {
    id: 'line_pilot_direction', code: '85', name: '纵联方向保护', category: 'line', group: '主保护',
    defaultEnabled: false, quantity: 'current',
    description: '通过通道比较两端方向元件，判别区内/区外故障，适用于无光纤差动条件的线路。',
    settings: [s('pickup', '方向启动电流', 400, 'A', 1, 10000, 10), s('angle', '最大灵敏角', 78, '°', 0, 180, 1), s('t', '动作时间', 0.03, 's', 0, 1, 0.005)]
  },
  {
    id: 'line_directional_oc', code: '67', name: '方向过流保护', category: 'line', group: '后备保护',
    defaultEnabled: true, quantity: 'current',
    description: '带方向闭锁的过流保护，防止反方向故障与环网潮流导致误动。',
    settings: [s('pickup', '启动电流', 500, 'A', 1, 20000, 10), s('angle', '方向边界角', 45, '°', 0, 90, 1), s('t', '动作时间', 0.5, 's', 0, 10, 0.01)]
  },
  {
    id: 'line_zero_seq_oc', code: '51N', name: '零序过流保护', category: 'line', group: '后备保护',
    defaultEnabled: true, quantity: 'current',
    description: '反映中性点接地系统单相接地故障的零序电流，按段整定并与相邻线路配合。',
    settings: [s('pickup', '零序启动值', 100, 'A', 1, 5000, 1), s('t1', 'I 段时间', 0.2, 's', 0, 10, 0.01), s('t2', 'II 段时间', 0.8, 's', 0, 10, 0.01)]
  },
  {
    id: 'line_zero_seq_direction', code: '67N', name: '零序方向保护', category: 'line', group: '后备保护',
    defaultEnabled: true, quantity: 'current',
    description: '按零序功率方向判别接地故障方向，适用于多电源接地系统与环网。',
    settings: [s('pickup', '零序启动值', 80, 'A', 1, 5000, 1), s('t', '动作时间', 0.4, 's', 0, 10, 0.01), s('angle', '灵敏角', 75, '°', 0, 180, 1)]
  },
  {
    id: 'line_negative_seq_oc', code: '46', name: '负序过流保护', category: 'line', group: '异常运行',
    defaultEnabled: false, quantity: 'current',
    description: '反映不对称故障与三相不平衡，可作为断相、接地故障的后备。',
    settings: [s('pickup', '负序启动值', 120, 'A', 1, 5000, 1), s('t', '动作时间', 0.8, 's', 0, 20, 0.01)]
  },
  {
    id: 'line_thermal_overload', code: '49', name: '线路过负荷保护', category: 'line', group: '异常运行',
    defaultEnabled: true, quantity: 'current',
    description: '按线路热稳定电流与时间常数告警/跳闸，防止长期过负荷导致导线过热。',
    settings: [s('pickup', '过负荷启动值', 600, 'A', 1, 20000, 10), s('t', '告警延时', 5, 's', 0.1, 3600, 0.1)]
  },
  {
    id: 'line_overvoltage', code: '59', name: '线路过电压保护', category: 'line', group: '异常运行',
    defaultEnabled: false, quantity: 'voltage',
    description: '反映空载长线路电容效应、甩负荷等引起的工频过电压。',
    settings: [s('pickup', '过电压定值', 1.15, 'pu', 1, 1.6, 0.01), s('t', '动作时间', 1, 's', 0, 60, 0.1)]
  },
  {
    id: 'line_undervoltage', code: '27', name: '线路低电压保护', category: 'line', group: '异常运行',
    defaultEnabled: false, quantity: 'voltage',
    description: '反映系统电压崩溃、PT 断线或失压，可作为解列/备自投的启动条件。',
    settings: [s('pickup', '低电压定值', 0.85, 'pu', 0.5, 1, 0.01), s('t', '动作时间', 1, 's', 0, 60, 0.1)]
  },
  {
    id: 'line_breaker_failure', code: '50BF', name: '断路器失灵保护', category: 'line', group: '辅助与监视',
    defaultEnabled: true, quantity: 'current',
    description: '保护动作后断路器未断开且故障电流仍存在时，延时切除相邻断路器。',
    settings: [s('pickup', '失灵电流定值', 300, 'A', 1, 10000, 10), s('t', '失灵延时', 0.3, 's', 0.05, 5, 0.01)]
  },
  {
    id: 'line_fault_locator', code: 'FL', name: '故障测距', category: 'line', group: '辅助与监视',
    defaultEnabled: true, quantity: 'status',
    description: '按双端/单端阻抗法估算故障距离，为巡线提供参考。',
    settings: [s('lineLength', '线路长度', 30, 'km', 0.1, 2000, 0.1), s('speed', '波速系数', 0.98, '', 0.5, 1, 0.01)]
  },
  {
    id: 'line_power_swing', code: '68', name: '振荡闭锁', category: 'line', group: '辅助与监视',
    defaultEnabled: true, quantity: 'impedance',
    description: '区分系统振荡与短路，振荡期间闭锁距离/过流保护，防止误跳闸。',
    settings: [s('zReach', '振荡检测阻抗', 12, 'Ω', 0.1, 500, 0.1), s('tBlock', '闭锁时间', 1.5, 's', 0.1, 30, 0.1)]
  },
  {
    id: 'line_non_full_phase', code: '62', name: '非全相保护', category: 'line', group: '异常运行',
    defaultEnabled: true, quantity: 'current',
    description: '检测断路器单相/两相断开后的负序、零序电流，防止长期非全相运行。',
    settings: [s('i2', '负序启动值', 80, 'A', 1, 5000, 1), s('i0', '零序启动值', 100, 'A', 1, 5000, 1), s('t', '动作时间', 0.5, 's', 0, 20, 0.01)]
  },
  {
    id: 'line_weak_infeed', code: '78', name: '弱馈保护', category: 'line', group: '主保护',
    defaultEnabled: false, quantity: 'status',
    description: '弱电源侧在纵联保护中按低电压/电流突变量加速跳闸，解决弱馈线路灵敏度不足。',
    settings: [s('pickup', '低电压/电流门槛', 0.7, 'pu', 0.1, 1, 0.01), s('t', '动作时间', 0.1, 's', 0, 2, 0.01)]
  },

  // ---------------- Transformer protections ----------------
  {
    id: 'xfmr_differential', code: '87T', name: '变压器差动保护', category: 'transformer', group: '主保护', core: true,
    defaultEnabled: true, quantity: 'differential',
    description: '比较各侧电流相量，比率制动躲励磁涌流，是变压器绕组及引出线的主保护。',
    settings: []
  },
  {
    id: 'xfmr_overcurrent', code: '50/51', name: '变压器过流后备', category: 'transformer', group: '后备保护', core: true,
    defaultEnabled: true, quantity: 'current',
    description: '按变压器额定电流与电气深度整定的过流后备，作为差动拒动和外部故障的后备。',
    settings: []
  },
  {
    id: 'xfmr_diff_inst', code: '87T-2', name: '差动速断保护', category: 'transformer', group: '主保护',
    defaultEnabled: true, quantity: 'differential',
    description: '大电流下不经比率制动瞬时动作，快速切除严重区内故障。',
    settings: [s('pickup', '差动速断定值', 6, 'Ie', 1, 20, 0.1), s('t', '动作时间', 0.02, 's', 0, 0.5, 0.005)]
  },
  {
    id: 'xfmr_second_harmonic', code: '87T-H2', name: '二次谐波制动', category: 'transformer', group: '主保护',
    defaultEnabled: true, quantity: 'status',
    description: '利用二次谐波含量识别励磁涌流，闭锁差动保护。',
    settings: [s('ratio', '二次谐波制动比', 15, '%', 5, 40, 1), s('t', '返回延时', 0.1, 's', 0, 2, 0.01)]
  },
  {
    id: 'xfmr_fifth_harmonic', code: '87T-H5', name: '五次谐波制动', category: 'transformer', group: '主保护',
    defaultEnabled: false, quantity: 'status',
    description: '识别过励磁产生的五次谐波，闭锁差动保护，防止过励磁误动。',
    settings: [s('ratio', '五次谐波制动比', 25, '%', 5, 60, 1), s('t', '返回延时', 0.1, 's', 0, 2, 0.01)]
  },
  {
    id: 'xfmr_overexcitation', code: '24', name: '变压器过励磁保护', category: 'transformer', group: '异常运行',
    defaultEnabled: true, quantity: 'voltage',
    description: '按 V/Hz 反映铁芯过励磁，防止过电压/低频导致变压器过热。',
    settings: [s('vHz', 'V/Hz 定值', 1.1, 'pu', 1, 1.5, 0.01), s('t', '动作时间', 5, 's', 0.1, 120, 0.1)]
  },
  {
    id: 'xfmr_zero_seq_oc', code: '51NT', name: '变压器零序过流保护', category: 'transformer', group: '后备保护',
    defaultEnabled: true, quantity: 'current',
    description: '反映变压器中性点接地侧单相接地故障的零序电流，作为接地故障后备。',
    settings: [s('pickup', '零序启动值', 100, 'A', 1, 5000, 1), s('t', '动作时间', 0.5, 's', 0, 10, 0.01)]
  },
  {
    id: 'xfmr_zero_seq_direction', code: '67NT', name: '变压器零序方向保护', category: 'transformer', group: '后备保护',
    defaultEnabled: false, quantity: 'current',
    description: '按零序功率方向判别接地故障位于变压器内部或外部。',
    settings: [s('pickup', '零序启动值', 80, 'A', 1, 5000, 1), s('angle', '灵敏角', 75, '°', 0, 180, 1), s('t', '动作时间', 0.6, 's', 0, 10, 0.01)]
  },
  {
    id: 'xfmr_neutral_zero_seq', code: '51N', name: '中性点零序过流', category: 'transformer', group: '后备保护',
    defaultEnabled: true, quantity: 'current',
    description: '接于变压器中性点电流互感器，反映中性点接地电流，灵敏度高。',
    settings: [s('pickup', '中性点零序定值', 50, 'A', 1, 3000, 1), s('t', '动作时间', 0.5, 's', 0, 10, 0.01)]
  },
  {
    id: 'xfmr_gap_zero_seq', code: '51NG', name: '间隙零序过流', category: 'transformer', group: '后备保护',
    defaultEnabled: false, quantity: 'current',
    description: '中性点经间隙接地或经小电抗接地时，反映间隙击穿后的零序电流。',
    settings: [s('pickup', '间隙零序定值', 100, 'A', 1, 3000, 1), s('t', '动作时间', 0.3, 's', 0, 10, 0.01)]
  },
  {
    id: 'xfmr_overload', code: '49T', name: '变压器过负荷保护', category: 'transformer', group: '异常运行',
    defaultEnabled: true, quantity: 'current',
    description: '按绕组热特性反映长期过负荷，发出告警或延时跳闸。',
    settings: [s('pickup', '过负荷启动值', 1.1, 'Ie', 0.5, 2, 0.01), s('t', '告警延时', 10, 's', 0.1, 3600, 0.1)]
  },
  {
    id: 'xfmr_overvoltage', code: '59T', name: '变压器过电压保护', category: 'transformer', group: '异常运行',
    defaultEnabled: false, quantity: 'voltage',
    description: '反映变压器高压侧工频过电压，防止绝缘受损。',
    settings: [s('pickup', '过电压定值', 1.15, 'pu', 1, 1.6, 0.01), s('t', '动作时间', 2, 's', 0, 60, 0.1)]
  },
  {
    id: 'xfmr_undervoltage', code: '27T', name: '变压器低电压保护', category: 'transformer', group: '异常运行',
    defaultEnabled: false, quantity: 'voltage',
    description: '反映母线失压或电压崩溃，可作为备自投/解列启动。',
    settings: [s('pickup', '低电压定值', 0.85, 'pu', 0.5, 1, 0.01), s('t', '动作时间', 1, 's', 0, 60, 0.1)]
  },
  {
    id: 'xfmr_oil_temp', code: '26', name: '油温高保护', category: 'transformer', group: '非电量',
    defaultEnabled: true, quantity: 'temperature',
    description: '接油面温度计，按告警/跳闸两级整定，反映冷却系统异常与过负荷。',
    settings: [s('alarm', '告警温度', 85, '°C', 40, 120, 1), s('trip', '跳闸温度', 95, '°C', 50, 140, 1), s('t', '跳闸延时', 10, 's', 0, 600, 1)]
  },
  {
    id: 'xfmr_winding_temp', code: '49W', name: '绕组温度高保护', category: 'transformer', group: '非电量',
    defaultEnabled: true, quantity: 'temperature',
    description: '接绕组温度计或热模拟装置，反映绕组热点温度。',
    settings: [s('alarm', '告警温度', 95, '°C', 50, 140, 1), s('trip', '跳闸温度', 105, '°C', 60, 160, 1), s('t', '跳闸延时', 10, 's', 0, 600, 1)]
  },
  {
    id: 'xfmr_buchholz', code: '63', name: '瓦斯保护', category: 'transformer', group: '非电量',
    defaultEnabled: true, quantity: 'gas',
    description: '轻瓦斯告警、重瓦斯跳闸，反映变压器内部故障产生的气体。',
    settings: [s('light', '轻瓦斯容积', 250, 'mL', 100, 500, 10), s('heavy', '重瓦斯流速', 1.0, 'm/s', 0.5, 2, 0.1)]
  },
  {
    id: 'xfmr_pressure', code: '63P', name: '压力释放保护', category: 'transformer', group: '非电量',
    defaultEnabled: true, quantity: 'pressure',
    description: '反映油箱内部压力骤升，动作于跳闸或告警。',
    settings: [s('pressure', '压力释放定值', 50, 'kPa', 10, 150, 1), s('t', '延时', 0, 's', 0, 10, 0.1)]
  },
  {
    id: 'xfmr_cooling', code: '26C', name: '冷却器故障保护', category: 'transformer', group: '非电量',
    defaultEnabled: true, quantity: 'status',
    description: '监测冷却器电源、风扇/油泵故障，按温度与延时告警或降容。',
    settings: [s('delay', '故障延时', 30, 's', 1, 600, 1)]
  },
  {
    id: 'xfmr_oltc_block', code: 'OLTC', name: '有载调压闭锁', category: 'transformer', group: '辅助与监视',
    defaultEnabled: true, quantity: 'status',
    description: '电压越限、过负荷或保护动作时闭锁有载调压，防止事故扩大。',
    settings: [s('vBand', '闭锁电压带', 0.1, 'pu', 0.01, 0.3, 0.01), s('delay', '延时', 5, 's', 0.1, 300, 0.1)]
  },
  {
    id: 'xfmr_impedance', code: '21T', name: '变压器阻抗后备', category: 'transformer', group: '后备保护',
    defaultEnabled: false, quantity: 'impedance',
    description: '按变压器短路阻抗整定，作为外部故障/差动拒动的后备保护。',
    settings: [s('zReach', '阻抗定值', 12, 'Ω', 0.1, 500, 0.1), s('t', '动作时间', 1.5, 's', 0, 20, 0.01)]
  },

  // ---------------- Bus protections ----------------
  {
    id: 'bus_differential', code: '87B', name: '母线差动保护', category: 'bus', group: '主保护',
    defaultEnabled: true, quantity: 'differential',
    description: '比较母线各连接元件电流相量和，瞬时切除母线故障，是母线主保护。',
    settings: [s('pickup', '差动启动值', 0.2, 'Ie', 0.01, 2, 0.01), s('slope', '制动斜率', 0.5, 'pu', 0, 1, 0.01), s('t', '动作时间', 0.02, 's', 0, 0.5, 0.005)]
  },
  {
    id: 'bus_overcurrent', code: '50B/51B', name: '母线过流保护', category: 'bus', group: '后备保护',
    defaultEnabled: true, quantity: 'current',
    description: '作为母线差动的后备，按母线额定电流与系统短路水平整定。',
    settings: [s('pickup', '启动电流', 800, 'A', 1, 20000, 10), s('t', '动作时间', 0.6, 's', 0, 10, 0.01)]
  },
  {
    id: 'bus_breaker_failure', code: '50BF', name: '母线断路器失灵', category: 'bus', group: '辅助与监视',
    defaultEnabled: true, quantity: 'current',
    description: '母线保护动作后，若连接元件断路器拒动，经延时切除母联及相邻断路器。',
    settings: [s('pickup', '失灵电流定值', 300, 'A', 1, 10000, 10), s('t', '失灵延时', 0.3, 's', 0.05, 5, 0.01)]
  },
  {
    id: 'bus_dead_zone', code: 'DZ', name: '死区保护', category: 'bus', group: '主保护',
    defaultEnabled: true, quantity: 'current',
    description: '覆盖断路器与 CT 之间的死区，由母差/失灵逻辑联动切除对侧。',
    settings: [s('pickup', '死区电流定值', 300, 'A', 1, 10000, 10), s('t', '死区延时', 0.2, 's', 0.02, 3, 0.01)]
  },
  {
    id: 'bus_charging', code: '84B', name: '母线充电保护', category: 'bus', group: '辅助与监视',
    defaultEnabled: true, quantity: 'current',
    description: '母线由检修/冷备用转运行时短时投入，快速切除充电过程中的故障。',
    settings: [s('pickup', '充电保护定值', 400, 'A', 1, 10000, 10), s('t', '动作时间', 0.1, 's', 0, 2, 0.01)]
  },
  {
    id: 'bus_pt_fail', code: 'PT', name: '母线 PT 断线监视', category: 'bus', group: '异常运行',
    defaultEnabled: true, quantity: 'voltage',
    description: '检测 PT 二次断线/失压，闭锁相关电压保护并告警。',
    settings: [s('threshold', '断线电压门槛', 0.7, 'pu', 0.1, 1, 0.01), s('delay', '告警延时', 2, 's', 0, 60, 0.1)]
  },
  {
    id: 'bus_ct_fail', code: 'CT', name: '母线 CT 断线监视', category: 'bus', group: '异常运行',
    defaultEnabled: true, quantity: 'current',
    description: '检测 CT 二次开路/异常电流，闭锁母差并告警。',
    settings: [s('threshold', '异常电流门槛', 0.1, 'A', 0.01, 5, 0.01), s('delay', '告警延时', 2, 's', 0, 60, 0.1)]
  },
  {
    id: 'bus_insulation', code: '64B', name: '母线绝缘监视', category: 'bus', group: '异常运行',
    defaultEnabled: true, quantity: 'status',
    description: '监测母线/PT 二次对地绝缘及直流系统接地，异常时告警。',
    settings: [s('alarmMOhm', '告警绝缘', 1, 'MΩ', 0.01, 100, 0.01), s('tripMOhm', '跳闸绝缘', 0.1, 'MΩ', 0.01, 10, 0.01)]
  },
  {
    id: 'bus_arc', code: 'AFD', name: '弧光保护', category: 'bus', group: '主保护',
    defaultEnabled: true, quantity: 'status',
    description: '用弧光传感器与过流判据快速切除开关柜内部弧光故障，降低设备损伤。',
    settings: [s('intensity', '弧光强度定值', 5, 'klx', 0.1, 100, 0.1), s('t', '动作时间', 0.01, 's', 0, 0.2, 0.005)]
  },
  {
    id: 'bus_underfrequency', code: '81U', name: '低频减载', category: 'bus', group: '异常运行',
    defaultEnabled: true, quantity: 'frequency',
    description: '按频率分轮切除可中断负荷，抑制频率崩溃；与系统频率调节配合。',
    settings: [s('stage1', '第一轮频率', 49.0, 'Hz', 45, 50, 0.01), s('stage2', '第二轮频率', 48.5, 'Hz', 45, 50, 0.01), s('shedPct', '每轮切负荷', 10, '%', 1, 50, 1), s('t', '动作延时', 0.2, 's', 0, 10, 0.01)]
  },
  {
    id: 'bus_overfrequency', code: '81O', name: '过频保护', category: 'bus', group: '异常运行',
    defaultEnabled: false, quantity: 'frequency',
    description: '反映大机组甩负荷或有功盈余导致的频率升高，可动作于解列/切机。',
    settings: [s('pickup', '过频定值', 50.5, 'Hz', 50, 55, 0.01), s('t', '动作延时', 0.5, 's', 0, 20, 0.01)]
  },
  {
    id: 'bus_backup_transfer', code: 'BZT', name: '备自投', category: 'bus', group: '辅助与监视',
    defaultEnabled: true, quantity: 'voltage',
    description: '工作电源失压后自动投入备用电源，缩短停电时间。',
    settings: [s('vMin', '低电压启动', 0.7, 'pu', 0.1, 1, 0.01), s('delay', '备自投延时', 1.5, 's', 0.1, 30, 0.1)]
  },
  {
    id: 'bus_interlock', code: 'IL', name: '母线联锁', category: 'bus', group: '辅助与监视',
    defaultEnabled: true, quantity: 'status',
    description: '隔离开关/接地开关与断路器之间的防误联锁，防止带负荷拉合刀闸。',
    settings: [s('delay', '联锁确认延时', 0.2, 's', 0, 5, 0.01)]
  }
];

export const PROTECTION_COUNT = PROTECTION_CATALOG.length;

export function protectionsFor(category) {
  return PROTECTION_CATALOG.filter((p) => p.category === category);
}

export function protectionById(id) {
  return PROTECTION_CATALOG.find((p) => p.id === id) || null;
}

export function protectionDefaults(entry, context = {}) {
  const defaults = {};
  for (const field of entry.settings || []) {
    let value = field.value;
    if (entry.id === 'line_ground_distance' && field.key === 'z1' && context.z) value = Number((context.z * 0.8).toFixed(3));
    if (entry.id === 'line_fault_locator' && field.key === 'lineLength' && context.length) value = Number(context.length);
    if ((entry.id === 'line_thermal_overload' || entry.id === 'bus_overcurrent') && field.key === 'pickup' && context.rated) {
      value = Math.round(context.rated * 1.2);
    }
    defaults[field.key] = value;
  }
  return defaults;
}

export function createProtectionSet(category, context = {}) {
  const set = {};
  for (const entry of protectionsFor(category)) {
    set[entry.id] = {
      enabled: entry.defaultEnabled !== false,
      settings: protectionDefaults(entry, context)
    };
  }
  return set;
}

export function ensureProtectionSet(relay, category, context = {}) {
  if (!relay.protections || typeof relay.protections !== 'object') relay.protections = {};
  for (const entry of protectionsFor(category)) {
    const cur = relay.protections[entry.id];
    if (!cur) {
      relay.protections[entry.id] = { enabled: entry.defaultEnabled !== false, settings: protectionDefaults(entry, context) };
      continue;
    }
    if (!cur.settings || typeof cur.settings !== 'object') cur.settings = protectionDefaults(entry, context);
    for (const field of entry.settings || []) {
      if (cur.settings[field.key] == null) cur.settings[field.key] = protectionDefaults(entry, context)[field.key];
    }
  }
  return relay.protections;
}
