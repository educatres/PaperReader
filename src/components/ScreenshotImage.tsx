import { useEffect, useState } from 'react';
import { Expand } from 'lucide-react';
import { db } from '../lib/db';
import { useApp } from '../store';
import type { Screenshot } from '../types';
import { Modal } from './Modal';
import { getProjectId } from '../lib/projectContext';

export function ScreenshotImage({ image }: { image: Screenshot }) {
  const epoch = useApp(s => s.documentEpoch);
  const projectId = getProjectId();
  const [url, setUrl] = useState(''); const [missing, setMissing] = useState(false); const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    let disposed = false; let objectUrl = ''; setUrl(''); setMissing(false);
    if (!projectId) return;
    db.assets.get([projectId, image.assetId]).then(asset => {
      if (disposed) return;
      if (!asset || asset.sha256 !== image.sha256 || asset.blob.size !== image.size) { setMissing(true); return; }
      objectUrl = URL.createObjectURL(asset.blob); setUrl(objectUrl);
    }).catch(() => { if (!disposed) setMissing(true); });
    return () => { disposed = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [projectId, image.assetId, image.sha256, image.size, epoch]);
  return <div className="screenshot-image nowheel">
    {url && !missing ? <button className="screenshot-thumbnail" aria-label="放大截圖" onClick={e => { e.stopPropagation(); setExpanded(true); }}><img src={url} alt={`PDF 第 ${image.pageIndex + 1} 頁框選截圖`} draggable={false} onError={() => setMissing(true)} /><span><Expand size={12} />放大截圖</span></button>
      : <p className="screenshot-missing">{missing ? '缺少截圖圖片，請匯入含圖片的完整研究封裝。便條文字仍可使用。' : '正在載入本機截圖…'}</p>}
    {expanded && url && <Modal title={`PDF 截圖 · p. ${image.pageIndex + 1}`} description="圖片僅供閱讀；AI 只讀取便條文字。" wide onClose={() => setExpanded(false)}><div className="screenshot-full nowheel"><img src={url} alt="完整框選截圖" draggable={false} /></div></Modal>}
  </div>;
}
