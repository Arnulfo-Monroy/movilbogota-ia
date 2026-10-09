// Datos propios de la aplicación (catálogo de demostración).
// Las coordenadas son aproximadas y los nombres con "(demo)" son ficticios:
// sirven para probar la consulta de datos propios, no como información oficial.

export const TIPOS_NECESIDAD = [
  { clave: 'transporte_publico', descripcion: 'Encontrar una estación o parada de transporte público', categorias_propias: ['estacion_transmilenio'], categoria_geoapify: 'public_transport' },
  { clave: 'salud_urgente', descripcion: 'Atención médica cercana', categorias_propias: ['centro_salud'], categoria_geoapify: 'healthcare.hospital,healthcare.clinic_or_praxis' },
  { clave: 'farmacia', descripcion: 'Farmacia cercana', categorias_propias: ['farmacia'], categoria_geoapify: 'healthcare.pharmacy' },
  { clave: 'parqueadero', descripcion: 'Parqueadero para vehículo', categorias_propias: ['parqueadero'], categoria_geoapify: 'parking' },
  { clave: 'bicicleta', descripcion: 'Taller, bicicletero o alquiler de bicicletas', categorias_propias: ['taller_bicicletas', 'bicicletero'], categoria_geoapify: 'rental.bicycle' },
  { clave: 'carga_electrica', descripcion: 'Punto de carga para vehículo eléctrico', categorias_propias: ['punto_carga'], categoria_geoapify: 'service.vehicle.charging_station' },
  { clave: 'ruta_a_destino', descripcion: 'Llegar desde el origen a un destino indicado por el usuario', categorias_propias: [], categoria_geoapify: null },
];

const s = (id, nombre, categoria, lat, lon, direccion, horario, accesible, notas) =>
  ({ id, nombre, categoria, lat, lon, direccion, horario, accesible, notas });

export const SERVICIOS = [
  s('tm01', 'Portal Norte (TransMilenio)', 'estacion_transmilenio', 4.7545, -74.0455, 'Autopista Norte, calle 170', 'Operación diaria (horario no verificado)', 1, 'Cabecera de troncal'),
  s('tm02', 'Portal 80 (TransMilenio)', 'estacion_transmilenio', 4.7105, -74.1128, 'Av. Calle 80 con Av. Boyacá', 'Operación diaria (horario no verificado)', 1, 'Cabecera de troncal'),
  s('tm03', 'Portal Américas (TransMilenio)', 'estacion_transmilenio', 4.6290, -74.1345, 'Av. de las Américas con Av. Ciudad de Cali', 'Operación diaria (horario no verificado)', 1, 'Cabecera de troncal'),
  s('tm04', 'Museo del Oro (TransMilenio)', 'estacion_transmilenio', 4.6015, -74.0720, 'Av. Jiménez con carrera 5', 'Operación diaria (horario no verificado)', 1, 'Cerca del centro histórico'),
  s('tm05', 'Calle 100 (TransMilenio)', 'estacion_transmilenio', 4.6845, -74.0450, 'Autopista Norte con calle 100', 'Operación diaria (horario no verificado)', 1, 'Zona empresarial'),
  s('tm06', 'Ciudad Universitaria (TransMilenio)', 'estacion_transmilenio', 4.6385, -74.0830, 'Av. NQS con calle 45', 'Operación diaria (horario no verificado)', 1, 'Cerca de la Universidad Nacional'),
  s('cs01', 'Hospital Universitario San Ignacio', 'centro_salud', 4.6278, -74.0646, 'Carrera 7 con calle 40', 'Urgencias 24 horas (a confirmar)', 1, 'Hospital de alta complejidad'),
  s('cs02', 'Centro de salud Chapinero (demo)', 'centro_salud', 4.6490, -74.0630, 'Chapinero (dirección ficticia)', 'Lun-Sáb 7:00-18:00', 1, 'Consulta general, sin urgencias'),
  s('cs03', 'Clínica de urgencias Suba (demo)', 'centro_salud', 4.7130, -74.0720, 'Suba (dirección ficticia)', '24 horas', 0, 'Rampa de acceso en reparación'),
  s('fa01', 'Farmacia Chapinero (demo)', 'farmacia', 4.6535, -74.0600, 'Chapinero (dirección ficticia)', 'Todos los días 7:00-22:00', 1, ''),
  s('fa02', 'Farmacia Centro (demo)', 'farmacia', 4.6020, -74.0690, 'Centro (dirección ficticia)', 'Lun-Sáb 8:00-20:00', 1, ''),
  s('fa03', 'Farmacia Kennedy (demo)', 'farmacia', 4.6300, -74.1500, 'Kennedy (dirección ficticia)', '24 horas', 1, ''),
  s('pq01', 'Parqueadero Zona T (demo)', 'parqueadero', 4.6665, -74.0545, 'Zona T (dirección ficticia)', '24 horas', 1, 'Tarifa por hora'),
  s('pq02', 'Parqueadero Centro Internacional (demo)', 'parqueadero', 4.6120, -74.0700, 'Centro Internacional (dirección ficticia)', 'Lun-Sáb 6:00-22:00', 1, ''),
  s('pq03', 'Parqueadero Usaquén (demo)', 'parqueadero', 4.6950, -74.0310, 'Usaquén (dirección ficticia)', 'Todos los días 7:00-23:00', 0, 'Cupo limitado fines de semana'),
  s('bc01', 'Bicicletero Parque 93 (demo)', 'bicicletero', 4.6760, -74.0480, 'Parque de la 93 (ubicación aproximada)', '24 horas', 1, 'Sin vigilancia'),
  s('bc02', 'Bicicletero Universidad Nacional (demo)', 'bicicletero', 4.6380, -74.0840, 'Ciudad Universitaria (ubicación aproximada)', 'Lun-Sáb 6:00-20:00', 1, 'Con vigilancia'),
  s('bc03', 'Bicicletero Portal 80 (demo)', 'bicicletero', 4.7108, -74.1120, 'Portal 80 (ubicación aproximada)', '5:00-23:00', 1, 'Con vigilancia'),
  s('tb01', 'Taller de bicicletas Chapinero (demo)', 'taller_bicicletas', 4.6420, -74.0640, 'Chapinero (dirección ficticia)', 'Lun-Sáb 9:00-18:00', 1, 'Reparación de llantas y frenos'),
  s('tb02', 'Taller de bicicletas Teusaquillo (demo)', 'taller_bicicletas', 4.6300, -74.0750, 'Teusaquillo (dirección ficticia)', 'Lun-Vie 8:00-17:00', 1, 'Repuestos básicos'),
  s('tb03', 'Taller de bicicletas Suba (demo)', 'taller_bicicletas', 4.7400, -74.0900, 'Suba (dirección ficticia)', 'Lun-Sáb 9:00-19:00', 0, 'Servicio rápido de pinchazos'),
  s('pc01', 'Punto de carga eléctrica Zona T (demo)', 'punto_carga', 4.6665, -74.0525, 'Zona T (dirección ficticia)', '24 horas', 1, 'Conector tipo 2'),
];
