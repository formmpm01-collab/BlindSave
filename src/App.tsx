import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowDown, ArrowRight, ArrowUpRight, BarChart3, Check, ChevronDown, CircleHelp, FileCheck2, Leaf, LockKeyhole, RotateCcw, ShieldCheck, SlidersHorizontal, Upload, Wallet, Zap } from 'lucide-react';
import { analysisInputSchema, type Analysis, type AnalysisInput, type Rates, type Recommendation } from '../supabase/functions/_shared/engine';
import { exampleInput } from './lib/demo';
import { readConsumptionFile, type ConsumptionSummary } from './lib/csv';
import { runAnalysis } from './lib/api';
import { configurationError, isDemo, supabase } from './lib/supabase';
import { Captcha } from './components/Captcha';

const euro = (n: number) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(n);
const number = (n: number, digits = 0) => new Intl.NumberFormat('es-ES', { maximumFractionDigits: digits }).format(n);
type Draft = { p1: string; p2: string; p3: string; power1: string; power2: string } & Record<`rate_${keyof Rates}`, string>;
const emptyDraft: Draft = { p1: '', p2: '', p3: '', power1: '4.6', power2: '4.6', rate_p1: '', rate_p2: '', rate_p3: '', rate_powerP1: '', rate_powerP2: '', rate_monthlyFee: '0' };
const draftFromInput = (v: AnalysisInput): Draft => ({ p1: String(v.annualKwh.p1), p2: String(v.annualKwh.p2), p3: String(v.annualKwh.p3), power1: String(v.power.p1), power2: String(v.power.p2), ...Object.fromEntries(Object.entries(v.currentRates).map(([k, n]) => [`rate_${k}`, String(n)])) } as Draft);
const parseNumber = (value: string) => value.trim() === '' ? NaN : Number(value.replace(',', '.'));

function Field({ label, suffix, value, onChange, step = 'any', max }: { label: string; suffix: string; value: string; onChange: (value: string) => void; step?: string; max?: number }) {
  return <label className="field"><span>{label}</span><span className="input-wrap"><input type="number" min="0" max={max} step={step} value={value} onChange={e => onChange(e.target.value)} required /><small>{suffix}</small></span></label>;
}
function TariffCard({ item, index }: { item: Recommendation; index: number }) {
  const { tariff, breakdown, savings } = item;
  return <article className={`tariff-card ${index === 0 ? 'best' : ''}`}>
    <div className="tariff-top"><span className="provider-icon"><Zap size={19} /></span><div><small>{tariff.provider}</small><h3>{tariff.name}</h3></div>{index === 0 && <span className="pill green">Menor coste</span>}</div>
    <div className="tariff-price"><strong>{euro(breakdown.total / 12)}<small> / mes</small></strong><span className={savings > 0 ? 'saving' : 'muted'}>{savings > 0 ? `${euro(savings)} menos / año` : savings < 0 ? `${euro(-savings)} más / año` : 'Mismo coste estimado'}</span></div>
    <div className="tariff-features"><span><Check size={14} />{tariff.commitmentMonths ? `${tariff.commitmentMonths} meses de permanencia` : 'Sin permanencia'}</span>{tariff.renewable && <span><Leaf size={14} />Origen renovable</span>}</div>
    <details><summary>Desglose y condiciones <ChevronDown size={15} /></summary><div className="tariff-details"><dl><div><dt>Energía / año</dt><dd>{euro(breakdown.energy)}</dd></div><div><dt>Potencia / año</dt><dd>{euro(breakdown.power)}</dd></div><div><dt>Cuotas / año</dt><dd>{euro(breakdown.fees)}</dd></div><div><dt>Total / año</dt><dd>{euro(breakdown.total)}</dd></div></dl><p>Precios de energía: P1 {number(tariff.rates.p1, 6)} · P2 {number(tariff.rates.p2, 6)} · P3 {number(tariff.rates.p3, 6)} €/kWh.</p><p>Potencia: P1 {number(tariff.rates.powerP1, 6)} · P2 {number(tariff.rates.powerP2, 6)} €/kW/día.</p><p>{tariff.conditions}</p>{tariff.sourceUrl && <a href={tariff.sourceUrl} target="_blank" rel="noreferrer">Consultar fuente pública <ArrowUpRight size={14} /></a>}{tariff.verifiedAt && <p>Verificada el {new Date(tariff.verifiedAt).toLocaleDateString('es-ES')}.</p>}{tariff.isDemo && <p className="demo-text">Tarifa ficticia. No es una oferta contratable.</p>}</div></details>
  </article>;
}

export default function App() {
  const [view, setView] = useState<'analysis' | 'method' | 'privacy'>('analysis');
  const [mode, setMode] = useState<'manual' | 'csv'>('manual');
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [csv, setCsv] = useState<ConsumptionSummary | null>(null);
  const [result, setResult] = useState<Analysis | null>(null);
  const [usedInput, setUsedInput] = useState<AnalysisInput | null>(null);
  const [usedCsv, setUsedCsv] = useState<ConsumptionSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [noCommitment, setNoCommitment] = useState(false);
  const [captcha, setCaptcha] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [example, setExample] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLElement>(null);
  const update = (key: keyof Draft, value: string) => { setDraft(prev => ({ ...prev, [key]: value })); setDirty(true); setExample(false); };
  async function upload(file?: File) {
    if (!file || busy || uploading) return;
    setUploading(true); setError(''); setCsv(null); setDirty(true); setExample(false);
    try { setCsv(await readConsumptionFile(file)); } catch (e) { setError(e instanceof Error ? e.message : 'No se ha podido leer el archivo.'); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ''; }
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); setError('');
    const data = analysisInputSchema.safeParse({
      annualKwh: mode === 'csv' ? csv?.annualKwh : { p1: parseNumber(draft.p1), p2: parseNumber(draft.p2), p3: parseNumber(draft.p3) },
      power: { p1: parseNumber(draft.power1), p2: parseNumber(draft.power2) },
      currentRates: Object.fromEntries((['p1', 'p2', 'p3', 'powerP1', 'powerP2', 'monthlyFee'] as const).map(k => [k, parseNumber(draft[`rate_${k}`])])),
    });
    if (!data.success) { setError('Revisa los datos: consumo positivo, potencias entre 0 y 15 kW y todos los precios cumplimentados.'); return; }
    setBusy(true);
    try {
      const analysis = await runAnalysis(data.data, captcha);
      setResult(analysis); setUsedInput(data.data); setUsedCsv(mode === 'csv' ? csv : null); setDirty(false);
      window.setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
    } catch (e) { setError(e instanceof Error ? e.message : 'No se ha podido completar el análisis.'); }
    finally { setBusy(false); setCaptcha(''); setAttempt(v => v + 1); }
  }
  function loadExample() {
    setDraft(draftFromInput(exampleInput)); setMode('manual'); setExample(true); setDirty(true); setError(''); setView('analysis');
  }
  function reset() {
    if (busy || uploading) return;
    setDraft(emptyDraft); setCsv(null); setResult(null); setUsedInput(null); setUsedCsv(null); setDirty(false); setError(''); setExample(false); setNoCommitment(false);
    if (supabase) void supabase.auth.signOut({ scope: 'local' });
  }
  const alternatives = result?.recommendations.filter(r => !noCommitment || r.tariff.commitmentMonths === 0) ?? [];
  const best = alternatives[0];
  const totalKwh = result?.annualKwh ?? 0;
  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#" onClick={e => { e.preventDefault(); setView('analysis'); }}><span className="brand-mark"><Zap size={22} fill="currentColor" /></span>blindsave<span className="brand-dot">.</span></a>
      <div className="workspace-label">TU ESPACIO DE AHORRO</div>
      <nav aria-label="Navegación principal">
        <button className={view === 'analysis' ? 'nav-link active' : 'nav-link'} onClick={() => setView('analysis')}><BarChart3 size={19} /> Mi análisis <span className="nav-dot" /></button>
        <button className={view === 'method' ? 'nav-link active' : 'nav-link'} onClick={() => setView('method')}><CircleHelp size={19} /> Cómo calculamos</button>
        <button className={view === 'privacy' ? 'nav-link active' : 'nav-link'} onClick={() => setView('privacy')}><ShieldCheck size={19} /> Tu privacidad</button>
      </nav>
      <div className="sidebar-note"><span className="lock-circle"><LockKeyhole size={20} /></span><h3>Tus datos son tuyos.</h3><p>Sin facturas. Sin nombres.<br />Sin cuenta de correo.</p><button onClick={() => setView('privacy')}>Conoce el proceso <ArrowRight size={14} /></button></div>
      <div className="sidebar-bottom"><span className="avatar">B</span><div>Sesión privada<small>{isDemo ? 'Demostración local' : 'Sin registro personal'}</small></div><span className="status-dot" /></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb">Tu hogar <span>/</span> <strong>Electricidad</strong></div><span className="privacy-status"><ShieldCheck size={15} /> Privacidad por diseño</span></header>
      <main>
        <div className="mode-banner"><span className="pill">{isDemo ? 'DEMO' : 'SUPABASE'}</span>{isDemo ? 'Estás en modo demostración. Las tarifas son ficticias y el cálculo es local.' : 'Solo comparamos tarifas verificadas y vigentes del catálogo publicado.'}</div>
        {configurationError && <p role="alert" className="error">Configuración incompleta: establece la URL y la clave pública de Supabase.</p>}
        {view === 'analysis' ? <>
          <section className="hero"><div><div className="eyebrow"><span /> ELECTRICIDAD, CON PERSPECTIVA</div><h1>Menos gasto.<br /><span>La misma tranquilidad.</span></h1><p>Descubre qué tarifa encaja con tu consumo.<br className="desktop-break" /> Con números claros y sin compartir tu factura.</p></div><div className="hero-actions"><button className="button secondary" onClick={loadExample} disabled={busy || uploading}>Probar con un ejemplo <ArrowUpRight size={17} /></button><small>Solo necesitas tus consumos y precios</small></div></section>
          <div className="steps"><span className="current"><b>01</b> Añade tu consumo</span><span className={result ? 'current' : ''}><b>02</b> Compara tus opciones</span><span><b>03</b> Decide con información</span></div>
          <section className="input-section">
            <div className="section-title"><div><h2>Empecemos por tus números</h2><p>Electricidad 2.0TD · Península y Baleares · Hasta 15 kW</p></div><button className="text-button" onClick={reset} disabled={busy || uploading}><RotateCcw size={14} /> Borrar datos</button></div>
            <form onSubmit={submit}>
              <fieldset disabled={busy || uploading} className="form-fieldset">
                <div className="entry-grid"><div className="consumption-entry"><div className="segmented" role="group" aria-label="Forma de introducir consumo"><button type="button" aria-pressed={mode === 'manual'} className={mode === 'manual' ? 'selected' : ''} onClick={() => { setMode('manual'); setDirty(true); }}><SlidersHorizontal size={15} /> Entrada manual</button><button type="button" aria-pressed={mode === 'csv'} className={mode === 'csv' ? 'selected' : ''} onClick={() => { setMode('csv'); setDirty(true); }}><Upload size={15} /> Importar CSV</button></div>
                  {mode === 'manual' ? <><h3>Consumo anual por periodo</h3><p className="field-help">Suma los kWh de los últimos 12 meses por tramo.</p><div className="fields three">{(['p1', 'p2', 'p3'] as const).map((p, i) => <Field key={p} label={['Punta · P1', 'Llano · P2', 'Valle · P3'][i]} suffix="kWh" value={draft[p]} max={150000} onChange={v => update(p, v)} />)}</div></> : <><div className={`dropzone ${dragging ? 'dragging' : ''}`} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); void upload(e.dataTransfer.files[0]); }}><span className="upload-icon">{csv ? <FileCheck2 size={24} /> : <Upload size={24} />}</span><strong>{uploading ? 'Validando lecturas…' : csv ? `${csv.rows} lecturas validadas` : 'Arrastra tu CSV aquí'}</strong><span>{csv ? `${csv.days} días · ${number(csv.totalKwh, 1)} kWh · Solo en memoria` : 'o selecciona un archivo · Máximo 2 MB'}</span><button type="button" className="text-button" onClick={() => fileRef.current?.click()}>{csv ? 'Cambiar archivo' : 'Seleccionar CSV'} <ArrowRight size={14} /></button><input ref={fileRef} type="file" accept=".csv,text/csv" hidden aria-label="Archivo de consumo CSV" onChange={e => void upload(e.target.files?.[0])} /></div><p className="field-help">Solo columnas fecha, hora y kwh. Horas 0–23, inicio del intervalo. <a href="/plantilla-consumo.csv" download>Descargar ejemplo</a>.</p><p className="field-help">Entre 28 y 366 días completos. Elimina los identificadores de la exportación de tu distribuidora antes de importar.</p>{csv && csv.days < 365 && <p className="notice">Se extrapolan {csv.days} días a 365. La estacionalidad puede cambiar el resultado.</p>}</>}
                </div><div className="power-entry"><div className="mini-heading"><Zap size={17} /><h3>Tu potencia contratada</h3></div><p className="field-help">La encontrarás en los datos de tu contrato.</p><div className="fields two"><Field label="Punta · P1" suffix="kW" value={draft.power1} max={15} onChange={v => update('power1', v)} /><Field label="Valle · P2" suffix="kW" value={draft.power2} max={15} onChange={v => update('power2', v)} /></div><div className="privacy-inline"><LockKeyhole size={16} /><span>El archivo permanece en tu navegador. Solo se usan totales numéricos para comparar.</span></div></div></div>
                <div className="current-prices"><h3>Los precios de tu tarifa actual <span>Antes de impuestos</span></h3><p className="field-help">Usa los precios finales tras descuentos e incluye los servicios obligatorios en la cuota. Si tienes precio único, repítelo en los tres tramos.</p><div className="fields rates">{(['p1', 'p2', 'p3', 'powerP1', 'powerP2', 'monthlyFee'] as const).map((key, i) => <Field key={key} label={['Energía P1', 'Energía P2', 'Energía P3', 'Potencia P1', 'Potencia P2', 'Cuota fija'][i]} suffix={i < 3 ? '€/kWh' : i < 5 ? '€/kW/día' : '€/mes'} value={draft[`rate_${key}`]} max={i < 5 ? 5 : 1000} onChange={v => update(`rate_${key}`, v)} />)}</div></div>
                <div className="form-bottom"><span><ShieldCheck size={16} />{example ? 'Datos de consumo de ejemplo cargados' : 'Sin guardar tu consumo en el servidor'}</span><button className="button primary" type="submit" disabled={busy || uploading || (mode === 'csv' && !csv) || configurationError || (!isDemo && Boolean(import.meta.env.VITE_TURNSTILE_SITE_KEY) && !captcha)}>{busy ? 'Calculando alternativas…' : 'Calcular mi ahorro'}<ArrowRight size={17} /></button></div>
              </fieldset>
              {!isDemo && <Captcha onToken={setCaptcha} attempt={attempt} />}
              {error && <p className="error" role="alert">{error}</p>}
            </form>
          </section>
          <section ref={resultsRef} className="results" aria-live="polite" aria-busy={busy}>
            <div className="section-title"><div><div className="eyebrow">TU RADIOGRAFÍA ENERGÉTICA</div><h2>El ahorro empieza por entender.</h2></div>{result && <span className="pill">{dirty ? 'Datos editados · vuelve a calcular' : 'Análisis actualizado'}</span>}</div>
            {result && best && usedInput ? <>
              <div className="metrics"><article className="metric"><span><Wallet size={17} />Tu coste de referencia</span><strong>{euro(result.current.total)}</strong><small>al año · según los precios introducidos</small></article><article className="metric"><span><Zap size={17} />La alternativa más económica</span><strong>{euro(best.breakdown.total)}</strong><small>al año · {best.tariff.name}</small></article><article className="metric highlight"><span><ArrowDown size={17} />{best.savings > 0 ? 'Tu ahorro potencial' : 'Tu tarifa actual es competitiva'}</span><strong>{euro(Math.max(0, best.savings))}{best.savings > 0 && <b>−{number(best.savingsPercent, 1)} %</b>}</strong><small>{best.savings > 0 ? `${euro(best.savings / 12)} menos cada mes, de media` : 'No encontramos una alternativa más barata'}</small></article></div>
              <p className="calculation-note">Estimación de 365 días, sin impuestos ni alquiler de contador. No incluye penalizaciones de salida. {isDemo && 'Comparación ilustrativa con tarifas ficticias.'} {usedCsv && usedCsv.days !== 365 && `Consumo extrapolado desde ${usedCsv.days} días; no corrige la estacionalidad.`}</p>
              <div className="results-grid"><div><article className="chart-card"><div className="card-heading"><h3>Así se reparte tu consumo</h3><span className="pill">{number(totalKwh)} kWh / año</span></div><div className="consumption-bar" role="img" aria-label="Distribución del consumo anual por periodos">{(['p1', 'p2', 'p3'] as const).map(p => <div key={p} className={p} style={{ width: `${usedInput.annualKwh[p] / totalKwh * 100}%` }} />)}</div><div className="period-legend">{(['p1', 'p2', 'p3'] as const).map((p, i) => <div key={p}><span><i className={p} />{['Punta', 'Llano', 'Valle'][i]}</span><strong>{number(usedInput.annualKwh[p] / totalKwh * 100, 1)} %</strong><small>{number(usedInput.annualKwh[p])} kWh</small></div>)}</div>{usedCsv ? <><div className="chart-label">Consumo horario medio <span>kWh / intervalo</span></div><div className="hourly-chart" role="img" aria-label="Consumo medio por hora, con valores en la tabla desplegable"><div className="bars">{usedCsv.hourlyAverage.map((v, h) => <div key={h} style={{ height: `${Math.max(1, v / Math.max(...usedCsv.hourlyAverage) * 100)}%` }} title={`${h}:00 · ${number(v, 3)} kWh`} />)}</div><div className="chart-axis"><span>00 h</span><span>06 h</span><span>12 h</span><span>18 h</span><span>23 h</span></div></div><details className="data-table"><summary>Ver valores de la gráfica</summary><table><thead><tr><th>Hora</th><th>Consumo medio (kWh)</th></tr></thead><tbody>{usedCsv.hourlyAverage.map((v, h) => <tr key={h}><td>{h}:00</td><td>{number(v, 3)}</td></tr>)}</tbody></table></details></> : <div className="chart-empty"><BarChart3 size={22} /><p>¿Quieres ver tu curva horaria?<span>Importa un CSV para descubrir cómo cambia tu consumo a lo largo del día.</span></p></div>}</article><article className="insight"><span><Leaf size={20} /></span><div><h3>Una lectura de tus números</h3><p>El {number(usedInput.annualKwh.p3 / totalKwh * 100, 1)} % de tu consumo corresponde al periodo valle. La clasificación compara ese reparto con el precio de cada tarifa, sumando potencia y cuotas.</p><small>Cálculo determinista · No se ha utilizado IA ni se infieren picos de potencia.</small></div></article></div><div className="alternatives"><div className="card-heading"><h3>Tus alternativas <span className="count">{alternatives.length}</span></h3><label className="filter"><input type="checkbox" checked={noCommitment} onChange={e => setNoCommitment(e.target.checked)} /> Sin permanencia</label></div>{alternatives.map((item, index) => <TariffCard key={item.tariff.id} item={item} index={index} />)}<p className="field-help">Ordenadas por coste anual. No cobramos ni tramitamos contrataciones.</p></div></div>
            </> : result ? <div className="empty-results"><h3>No hay alternativas con este filtro.</h3><button className="button secondary" onClick={() => setNoCommitment(false)}>Mostrar todas las tarifas</button></div> : <div className="empty-results"><span className="empty-icon"><BarChart3 size={28} /></span><h3>Tus mejores opciones, aquí.</h3><p>Completa tus datos y calcularemos el coste de cada alternativa.<br />Sin estimaciones ocultas ni recomendaciones patrocinadas.</p></div>}
          </section>
        </> : <section className="info-page"><div className="eyebrow">BLINDSAVE · DISEÑADO PARA ENTENDER</div><h1>{view === 'privacy' ? 'Menos datos. Más control.' : 'Números que puedes comprobar.'}</h1>{view === 'privacy' ? <><p className="lead">No pedimos facturas, nombres, direcciones, CUPS ni información bancaria.</p><article><h2>El archivo se queda en tu equipo</h2><p>Validamos el CSV en el navegador. Rechazamos columnas no permitidas y campos que no se ajustan a fechas, horas y consumos. No enviamos el archivo, su nombre ni las lecturas horarias. La validación reduce la exposición, pero no equivale a una garantía universal de anonimización.</p></article><article><h2>Qué sale del navegador</h2><p>{isDemo ? 'En esta demostración, el análisis es local y no se conecta con Supabase.' : 'Al calcular, Supabase recibe tres totales anuales de consumo, dos potencias y los precios de tu tarifa. La función calcula la comparación en memoria, sin guardar esos valores.'} No hay analítica publicitaria ni almacenamiento del consumo en cookies o localStorage.</p></article><article><h2>Sesión anónima no significa ausencia de metadatos</h2><p>En producción, Supabase Auth crea un identificador de sesión sin correo. Los proveedores de infraestructura pueden procesar IP y registros técnicos. Un contador temporal por sesión limita el uso del servicio. Si se activa CAPTCHA, Cloudflare procesa la verificación. Esto no permite afirmar que todo el servicio esté exento de datos personales.</p></article><article><h2>Tú decides cuándo terminar</h2><p>«Borrar datos» limpia el formulario y los resultados de la memoria de esta página y cierra la sesión local. No elimina de forma inmediata los registros técnicos del proveedor. No ofrecemos aún guardado de análisis ni cuentas de correo.</p><button className="button secondary" onClick={() => { reset(); setView('analysis'); }} disabled={busy || uploading}>Borrar mis datos de esta página <RotateCcw size={16} /></button></article></> : <><p className="lead">El motor aplica la misma fórmula a todas las tarifas de precio fijo del catálogo.</p><article><h2>Una fórmula, tres componentes</h2><div className="formula">Energía + potencia + cuotas = coste anual</div><p>Energía: kWh anuales de cada periodo × su precio por kWh. Potencia: kW contratados × €/kW/día × 365. Cuotas: importe mensual × 12. El ahorro es la diferencia frente a tu contrato, usando los precios que introduces.</p><p>Excluimos impuestos, alquiler de contador y penalizaciones de salida. Las tarifas deben incluir todas las cuotas obligatorias y mantener sus precios durante 365 días. No calculamos PVPC, tarifas indexadas, autoconsumo, bonos sociales ni promociones con precios cambiantes.</p></article><article><h2>Lecturas horarias y periodos</h2><p>La plantilla utiliza fechas AAAA-MM-DD y horas locales 0–23 que indican el inicio de cada intervalo. Solo se admite Península y Baleares. Se comprueban días consecutivos, lecturas completas y cambios de hora. Un CSV de distribuidora necesita adaptarse a esta plantilla.</p><p>Valle: de 00 a 08 h, fines de semana y festivos nacionales de fecha fija no sustituibles, más el 6 de enero. Punta: 10–14 y 18–22 h en el resto de días. Llano: las horas restantes. No se aplican festivos autonómicos o locales.</p><a href="https://www.cnmc.es/file/304517/download" target="_blank" rel="noreferrer">Consultar los periodos en la CNMC <ArrowUpRight size={14} /></a></article><article><h2>Estimación, no promesa</h2><p>Normalizamos el consumo a 365 días. Una muestra inferior al año se extrapola proporcionalmente y no representa necesariamente el invierno o el verano. Tampoco se puede deducir la potencia máxima instantánea a partir de una media horaria.</p></article><article><h2>Fuentes antes que respuestas inventadas</h2><p>En producción solo se publican tarifas revisadas, con fuente pública y vigencia. Puedes consultar sus condiciones en cada resultado. La extracción automática con IA y el asistente de mercado con citas son fases posteriores; esta versión no simula respuestas de un chatbot.</p></article></>}<button className="button primary" onClick={() => setView('analysis')}>Volver a mi análisis <ArrowRight size={17} /></button></section>}
        <footer><span><Zap size={14} /> blindsave. <span>Consume con criterio.</span></span><button onClick={() => setView('privacy')}>Privacidad por diseño <ArrowUpRight size={13} /></button></footer>
      </main>
    </div>
  </div>;
}
