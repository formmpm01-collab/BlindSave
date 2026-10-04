import { z } from 'zod';
import { analyze, tariffSchema, type Analysis, type AnalysisInput } from '../../supabase/functions/_shared/engine';
import { demoTariffs } from './demo';
import { configurationError, isDemo, supabase } from './supabase';

export async function runAnalysis(input: AnalysisInput, captchaToken?: string): Promise<Analysis> {
  if (configurationError) throw new Error('La configuración de Supabase está incompleta. Revisa la URL y la clave pública.');
  if (isDemo) return analyze(input, demoTariffs);
  if (!supabase) throw new Error('No se ha podido inicializar la conexión.');
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw new Error('No se ha podido comprobar la sesión. Recarga la página.');
  if (!sessionData.session) {
    const { error } = await supabase.auth.signInAnonymously({ options: { captchaToken } });
    if (error) throw new Error('No se ha podido iniciar la sesión anónima. Comprueba la verificación de seguridad o inténtalo más tarde.');
  }
  const { data, error } = await supabase.functions.invoke('analyze', { body: input });
  if (error) {
    const status = (error.context as Response | undefined)?.status;
    if (status === 429) throw new Error('Has alcanzado el límite de análisis. Inténtalo dentro de una hora.');
    if (status === 503) throw new Error('Todavía no hay tarifas verificadas y vigentes. Vuelve a intentarlo cuando el catálogo esté publicado.');
    throw new Error('No se ha podido realizar el análisis. Comprueba la conexión e inténtalo de nuevo.');
  }
  // Recompute from validated public prices, sharing exactly the same deterministic engine.
  const parsed = z.object({ tariffs: z.array(tariffSchema).min(1), calculatedAt: z.string().datetime() }).safeParse(data);
  if (!parsed.success) throw new Error('El catálogo recibido no tiene un formato válido. Inténtalo más tarde.');
  const response = parsed.data;
  if (response.tariffs.some(t => t.isDemo)) throw new Error('El catálogo contiene tarifas de demostración y no se puede utilizar en producción.');
  return analyze(input, response.tariffs, new Date(response.calculatedAt));
}
