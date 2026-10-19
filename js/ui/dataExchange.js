import { icon } from './icons.js';
import { showModal, closeModal } from './modal.js';
import { buildWorkbookXML, buildEquipmentCSV, buildCIMXML, buildBPAText, parseWorkbook } from '../data/exchange.js';

function download(name, text, mime) {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1200);
}

export function openDataExchange(app) {
  const body = `<div class="grid-2" style="gap:10px">
    <div class="card"><div class="card-head"><div><div class="card-title">${icon('grid', 14)} Excel 工作簿</div><div class="card-sub">SpreadsheetML 2003 · 工程 / 母线 / 支路 / 设备 / 保护</div></div></div><div class="card-body">
      <p class="hint" style="color:var(--muted);line-height:1.6">导出可直接用 Excel 打开的多工作表文件；按本工具生成的表头修改后，可重新导入更新工程（按 ID 匹配，新增行会创建对象）。</p>
      <div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:9px"><button class="btn btn-primary" data-xlsx>${icon('download', 12)} 导出 Excel</button><button class="btn" data-import>${icon('upload', 12)} 导入 Excel</button><input type="file" accept=".xml,.xls,text/xml,application/xml" data-file hidden></div>
    </div></div>
    <div class="card"><div class="card-head"><div><div class="card-title">${icon('database', 14)} CIM RDF</div><div class="card-sub">CIM 16 子集 · 设备 / 端子 / 联结节点</div></div></div><div class="card-body">
      <p class="hint" style="color:var(--muted);line-height:1.6">导出 RDF/XML 资产与拓扑子集，包含 BusbarSection、ConnectivityNode、Terminal、ACLineSegment、PowerTransformer 及电源/负荷。</p>
      <div style="margin-top:9px"><button class="btn" data-cim>${icon('download', 12)} 导出 CIM RDF</button></div>
    </div></div>
    <div class="card"><div class="card-head"><div><div class="card-title">${icon('file', 14)} PSD-BPA 风格卡</div><div class="card-sub">可读文本适配器 · 实验导出</div></div></div><div class="card-body">
      <p class="hint" style="color:var(--muted);line-height:1.6">按 B、G、L、T 卡片输出母线、机组、负荷、线路与变压器。该格式用于交换和人工复核，不是经过认证的 BPA 生产卡；正式 BPA 计算请按目标程序卡片手册补充控制卡。</p>
      <div style="margin-top:9px"><button class="btn" data-bpa>${icon('download', 12)} 导出 BPA 卡</button></div>
    </div></div>
    <div class="card"><div class="card-head"><div><div class="card-title">${icon('layers', 14)} 设备清单 CSV</div><div class="card-sub">Excel / 数据库导入友好的平面表</div></div></div><div class="card-body">
      <p class="hint" style="color:var(--muted);line-height:1.6">一条记录对应一个母线、支路或设备，适合批量核对、资产盘点或导入第三方数据库。</p>
      <div style="margin-top:9px"><button class="btn" data-csv>${icon('download', 12)} 导出设备 CSV</button></div>
    </div></div>
  </div>
  <div class="modal-help" style="margin-top:12px">${icon('info', 12)} Excel 导入只更新可识别的字段，不会删除文件中未出现的对象；导入后建议先运行潮流校验。CIM/BPA/CSV 当前为单向导出适配器。</div>`;
  const { root } = showModal({
    title: '数据导入 / 导出', kicker: 'DATA EXCHANGE',
    subtitle: `${app.project.meta.name} · ${app.project.buses.length} 母线 / ${app.project.branches.length} 支路 / ${app.project.injections.length} 设备 / ${app.project.relays.length} 保护`,
    body, size: 'lg',
    footer: `<button class="btn" data-modal-close>关闭</button>`,
    onMount: (modalRoot) => {
      modalRoot.querySelector('[data-modal-close]')?.addEventListener('click', () => closeModal());
      const file = modalRoot.querySelector('[data-file]');
      modalRoot.querySelector('[data-xlsx]')?.addEventListener('click', () => {
        download(`${app.project.meta.name}_工程数据.xls`, buildWorkbookXML(app.project), 'application/vnd.ms-excel;charset=utf-8');
        app.toast('Excel 已导出', '工作簿包含工程、母线、支路、设备和保护五个工作表。');
      });
      modalRoot.querySelector('[data-csv]')?.addEventListener('click', () => {
        download(`${app.project.meta.name}_设备清单.csv`, '\ufeff' + buildEquipmentCSV(app.project), 'text/csv;charset=utf-8');
        app.toast('设备 CSV 已导出', '可直接用 Excel 打开或导入数据库。');
      });
      modalRoot.querySelector('[data-cim]')?.addEventListener('click', () => {
        download(`${app.project.meta.name}_CIM.rdf`, buildCIMXML(app.project), 'application/rdf+xml;charset=utf-8');
        app.toast('CIM RDF 已导出', '包含母线、联结节点、端子与主要设备。');
      });
      modalRoot.querySelector('[data-bpa]')?.addEventListener('click', () => {
        download(`${app.project.meta.name}_BPA.dat`, buildBPAText(app.project), 'text/plain;charset=utf-8');
        app.toast('BPA 风格卡已导出', '该文件为简化交换格式，正式计算前需按目标程序补全控制卡。');
      });
      modalRoot.querySelector('[data-import]')?.addEventListener('click', () => file?.click());
      file?.addEventListener('change', async () => {
        const f = file.files?.[0];
        if (!f) return;
        try {
          const text = await f.text();
          const { project, summary } = parseWorkbook(text, app.project);
          app.applyImportedProject(project, summary, f.name);
          closeModal();
        } catch (e) {
          app.toast('导入失败', e.message, 'error');
        } finally {
          file.value = '';
        }
      });
    }
  });
  return root;
}
