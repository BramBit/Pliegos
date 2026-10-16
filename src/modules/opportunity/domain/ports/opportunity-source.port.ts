export interface RawSecopProcess {
  readonly id_del_proceso: string;
  readonly referencia_del_proceso: string;
  readonly nombre_del_procedimiento: string;
  readonly descripci_n_del_procedimiento?: string;
  readonly entidad: string;
  readonly nit_entidad: string;
  readonly ciudad_entidad?: string;
  readonly departamento_entidad?: string;
  readonly precio_base?: string;
  readonly tipo_de_contrato?: string;
  readonly modalidad_de_contratacion?: string;
  readonly estado_del_procedimiento?: string;
  readonly estado_resumen?: string;
  readonly estado_de_apertura_del_proceso?: 'Abierto' | 'Cerrado';
  readonly fecha_de_publicacion_del?: string;
  readonly fecha_de_recepcion_de?: string;
  readonly fecha_de_apertura_de_respuesta?: string;
  readonly codigo_principal_de_categoria?: string;
  readonly urlproceso?: { url: string };
  readonly proveedores_invitados?: string;
  readonly respuestas_al_procedimiento?: string;
}

export interface SourceFetchOptions {
  readonly pageSize?: number;
  readonly maxRecords?: number;
}

export interface OpportunitySourcePort {
  fetchLatest(since?: Date, options?: SourceFetchOptions): Promise<RawSecopProcess[]>;
  /** Optional streaming variant for large loads (processes one page at a time). */
  fetchPages?(since?: Date, options?: SourceFetchOptions): AsyncIterable<RawSecopProcess[]>;
}

export const OPPORTUNITY_SOURCE_PORT = Symbol('OPPORTUNITY_SOURCE_PORT');
