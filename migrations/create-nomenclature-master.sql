-- =====================================================
-- SUPABASE SQL MIGRATION: Nomenclature Master (SAS Part Number Configuration)
-- Run this in Supabase SQL Editor
-- =====================================================

-- Drop tables if they exist (for clean migration)
DROP TABLE IF EXISTS nomenclature_secondary CASCADE;
DROP TABLE IF EXISTS nomenclature_master CASCADE;

-- =====================================================
-- 1. Nomenclature Master (Primary Categories)
-- =====================================================
CREATE TABLE nomenclature_master (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    label VARCHAR(100) NOT NULL,
    acronym VARCHAR(10) NOT NULL,
    hint TEXT,
    sort_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    CONSTRAINT unique_tenant_acronym UNIQUE (tenant_id, acronym)
);

-- Index for faster lookups
CREATE INDEX idx_nomenclature_master_tenant ON nomenclature_master(tenant_id);
CREATE INDEX idx_nomenclature_master_active ON nomenclature_master(is_active);

-- Enable RLS
ALTER TABLE nomenclature_master ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only see their tenant's data
CREATE POLICY nomenclature_master_tenant_isolation ON nomenclature_master
    FOR ALL USING (tenant_id = current_setting('app.current_tenant')::UUID);

-- =====================================================
-- 2. Nomenclature Secondary (Secondary Categories)
-- =====================================================
CREATE TABLE nomenclature_secondary (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    primary_id UUID NOT NULL REFERENCES nomenclature_master(id) ON DELETE CASCADE,
    label VARCHAR(100) NOT NULL,
    acronym VARCHAR(10) NOT NULL,
    hint TEXT,
    sort_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_nomenclature_secondary_tenant ON nomenclature_secondary(tenant_id);
CREATE INDEX idx_nomenclature_secondary_primary ON nomenclature_secondary(primary_id);
CREATE INDEX idx_nomenclature_secondary_active ON nomenclature_secondary(is_active);

-- Enable RLS
ALTER TABLE nomenclature_secondary ENABLE ROW LEVEL SECURITY;

-- RLS Policy
CREATE POLICY nomenclature_secondary_tenant_isolation ON nomenclature_secondary
    FOR ALL USING (tenant_id = current_setting('app.current_tenant')::UUID);

-- =====================================================
-- 3. Trigger to auto-update updated_at
-- =====================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_nomenclature_master_updated_at BEFORE UPDATE ON nomenclature_master
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_nomenclature_secondary_updated_at BEFORE UPDATE ON nomenclature_secondary
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- 4. Seed Default Data (Same as current NOMENCLATURE_DATA)
-- =====================================================

-- Helper function to get tenant ID from acronym (for seeding)
CREATE OR REPLACE FUNCTION seed_nomenclature_data(p_tenant_id UUID)
RETURNS VOID AS $$
DECLARE
    v_primary_id UUID;
BEGIN
    -- Actuator
    INSERT INTO nomenclature_master (tenant_id, label, acronym, hint, sort_order) 
    VALUES (p_tenant_id, 'Actuator', 'ACT', 'PropellerSize, Power, NoRPM, Make', 1)
    RETURNING id INTO v_primary_id;
    
    INSERT INTO nomenclature_secondary (tenant_id, primary_id, label, acronym, hint, sort_order) VALUES
    (p_tenant_id, v_primary_id, 'Pump', 'PMP', NULL, 1),
    (p_tenant_id, v_primary_id, 'Motor', 'MTR', 'Motor Size, Power, NoRPM, Make', 2),
    (p_tenant_id, v_primary_id, 'Rim Drive Thruster', 'RDT', 'PropellerSize, Power, NoRPM, Make', 3),
    (p_tenant_id, v_primary_id, 'Servo', 'SER', 'Analog, RotationAngle, loadCapacity in KgCm, Make', 4),
    (p_tenant_id, v_primary_id, 'Thruster', 'THR', 'PropellerSize, Power, NoRPM, Make', 5);

    -- Auto Pilot Module
    INSERT INTO nomenclature_master (tenant_id, label, acronym, sort_order) 
    VALUES (p_tenant_id, 'Auto Pilot Module', 'APM', 2);

    -- Assembly External
    INSERT INTO nomenclature_master (tenant_id, label, acronym, sort_order) 
    VALUES (p_tenant_id, 'Assembly External', 'ASYE', 3)
    RETURNING id INTO v_primary_id;
    
    INSERT INTO nomenclature_secondary (tenant_id, primary_id, label, acronym, sort_order) VALUES
    (p_tenant_id, v_primary_id, 'Mechanical', 'MCH', 1),
    (p_tenant_id, v_primary_id, 'Electronics', 'ELE', 2);

    -- Assembly Internal
    INSERT INTO nomenclature_master (tenant_id, label, acronym, sort_order) 
    VALUES (p_tenant_id, 'Assembly Internal', 'ASYI', 4)
    RETURNING id INTO v_primary_id;
    
    INSERT INTO nomenclature_secondary (tenant_id, primary_id, label, acronym, sort_order) VALUES
    (p_tenant_id, v_primary_id, 'Mechanical', 'MCH', 1),
    (p_tenant_id, v_primary_id, 'Electronics', 'ELE', 2);

    -- Cables
    INSERT INTO nomenclature_master (tenant_id, label, acronym, sort_order) 
    VALUES (p_tenant_id, 'Cables', 'CAB', 5)
    RETURNING id INTO v_primary_id;
    
    INSERT INTO nomenclature_secondary (tenant_id, primary_id, label, acronym, hint, sort_order) VALUES
    (p_tenant_id, v_primary_id, 'Silicone', 'SIL', 'Colour, Gauge', 1),
    (p_tenant_id, v_primary_id, 'USB', 'USB', NULL, 2),
    (p_tenant_id, v_primary_id, 'Crimped', 'CRI', 'PinCode, Colour, Length, Gauge', 3),
    (p_tenant_id, v_primary_id, 'Balancing', 'BAL', 'MicroFit, Length, Gauge, Make', 4),
    (p_tenant_id, v_primary_id, 'Coaxial', 'CAX', 'Female SMA to UFL4, wire thickness (wire code)', 5),
    (p_tenant_id, v_primary_id, 'Multi Core', 'MCO', 'Cable Model, Each core wire thickness, part packing, Length, Make', 6),
    (p_tenant_id, v_primary_id, 'Single Core', 'SCO', 'Colour, Cable Model, Each core wire thickness, part packing, Length, Make', 7);

    -- Capacitor
    INSERT INTO nomenclature_master (tenant_id, label, acronym, sort_order) 
    VALUES (p_tenant_id, 'Capacitor', 'CAP', 6)
    RETURNING id INTO v_primary_id;
    
    INSERT INTO nomenclature_secondary (tenant_id, primary_id, label, acronym, hint, sort_order) VALUES
    (p_tenant_id, v_primary_id, 'Surface Mounted Device', 'SMD', 'CERAMIC/TANTALUM, UF Capacity, Voltage Capacity, Size', 1);

    -- Chemical
    INSERT INTO nomenclature_master (tenant_id, label, acronym, hint, sort_order) 
    VALUES (p_tenant_id, 'Chemical', 'CHM', 'Chemical Name', 7);

    -- Computer
    INSERT INTO nomenclature_master (tenant_id, label, acronym, hint, sort_order) 
    VALUES (p_tenant_id, 'Computer', 'COMP', 'Configuration', 8);

    -- Connector
    INSERT INTO nomenclature_master (tenant_id, label, acronym, sort_order) 
    VALUES (p_tenant_id, 'Connector', 'CON', 9)
    RETURNING id INTO v_primary_id;
    
    INSERT INTO nomenclature_secondary (tenant_id, primary_id, label, acronym, hint, sort_order) VALUES
    (p_tenant_id, v_primary_id, 'Bullet', 'BUL', 'Connector Size, Polarity', 1),
    (p_tenant_id, v_primary_id, 'Battery Connector', 'BTC', 'Connector Size, Polarity', 2),
    (p_tenant_id, v_primary_id, 'Miscellaneous', 'MIS', 'Type, Size', 3),
    (p_tenant_id, v_primary_id, 'Berg', 'BRG', 'Number of slots in single row, Type - Male/Female, Size of Pitch', 4),
    (p_tenant_id, v_primary_id, 'Relimate Connector', 'RMC', 'Type Male-Female, Number of pins, Size of Pitch', 5),
    (p_tenant_id, v_primary_id, 'JST XH', 'JXH', 'Type of Housing (Housing, Top, Side, Crimped), Male-Female, Number of Pins, Colour', 6),
    (p_tenant_id, v_primary_id, 'Microfit', 'MFT', 'Type of Housing, Number of Pin, Male-Female', 7),
    (p_tenant_id, v_primary_id, 'Antenna', 'ANT', 'Type of Mount, Type - SMA, Male-Female, Wire Type', 8),
    (p_tenant_id, v_primary_id, 'Circular', 'CIR', 'Model & CutOut dia & Type of lock - Mount Type - Polarity & pin count & Material & IP Rating, Straight or Right Angled', 9);

    -- Cordage
    INSERT INTO nomenclature_master (tenant_id, label, acronym, sort_order) 
    VALUES (p_tenant_id, 'Cordage', 'COR', 10)
    RETURNING id INTO v_primary_id;
    
    INSERT INTO nomenclature_secondary (tenant_id, primary_id, label, acronym, hint, sort_order) VALUES
    (p_tenant_id, v_primary_id, 'Cable Tie', 'ZIP', 'Size', 1),
    (p_tenant_id, v_primary_id, 'Rope', 'ROP', 'Type of Rope, Size', 2);

    -- Convertor
    INSERT INTO nomenclature_master (tenant_id, label, acronym, sort_order) 
    VALUES (p_tenant_id, 'Convertor', 'DCC', 11)
    RETURNING id INTO v_primary_id;
    
    INSERT INTO nomenclature_secondary (tenant_id, primary_id, label, acronym, hint, sort_order) VALUES
    (p_tenant_id, v_primary_id, 'Buck Convertor', 'BUC', 'Voltage', 1);

    -- Electronics Accessories
    INSERT INTO nomenclature_master (tenant_id, label, acronym, sort_order) 
    VALUES (p_tenant_id, 'Electronics Accessories', 'EAC', 12)
    RETURNING id INTO v_primary_id;
    
    INSERT INTO nomenclature_secondary (tenant_id, primary_id, label, acronym, sort_order) VALUES
    (p_tenant_id, v_primary_id, 'Torrid', 'TOR', 1);

    -- Electromagnetic Transducer
    INSERT INTO nomenclature_master (tenant_id, label, acronym, sort_order) 
    VALUES (p_tenant_id, 'Electromagnetic Transducer', 'EMT', 13)
    RETURNING id INTO v_primary_id;
    
    INSERT INTO nomenclature_secondary (tenant_id, primary_id, label, acronym, sort_order) VALUES
    (p_tenant_id, v_primary_id, 'Buzzer', 'BUZ', 1);

    -- Enclosure
    INSERT INTO nomenclature_master (tenant_id, label, acronym, hint, sort_order) 
    VALUES (p_tenant_id, 'Enclosure', 'ENC', 'Type of Enclosure - IP/NON-IP, Size, Material', 14);

    -- Expanded Polyethylene Foam
    INSERT INTO nomenclature_master (tenant_id, label, acronym, hint, sort_order) 
    VALUES (p_tenant_id, 'Expanded Polyethylene Foam', 'EPE', 'Thickness, Size', 15);

    -- Extrusion
    INSERT INTO nomenclature_master (tenant_id, label, acronym, sort_order) 
    VALUES (p_tenant_id, 'Extrusion', 'EXT', 16);

    -- Fabrication
    INSERT INTO nomenclature_master (tenant_id, label, acronym, sort_order) 
    VALUES (p_tenant_id, 'Fabrication', 'FAB', 17)
    RETURNING id INTO v_primary_id;
    
    INSERT INTO nomenclature_secondary (tenant_id, primary_id, label, acronym, hint, sort_order) VALUES
    (p_tenant_id, v_primary_id, 'Rotomoulding', 'ROT', 'Item, Weight, Colour', 1),
    (p_tenant_id, v_primary_id, 'Machining', 'MCN', 'Type of Machining and Other details', 2),
    (p_tenant_id, v_primary_id, 'Injection Moulding', 'IJM', 'Material Injected Moulded, Colour', 3),
    (p_tenant_id, v_primary_id, 'Gasket', 'GSK', NULL, 4),
    (p_tenant_id, v_primary_id, 'Casting', 'CST', NULL, 5),
    (p_tenant_id, v_primary_id, 'FRP', 'FRP', NULL, 6),
    (p_tenant_id, v_primary_id, 'Sheet Metal Component', 'SMC', NULL, 7),
    (p_tenant_id, v_primary_id, 'Rubber Moulding', 'RM', 'Vacuum casting, Rubber Moulding', 8);

    -- Fasteners
    INSERT INTO nomenclature_master (tenant_id, label, acronym, sort_order) 
    VALUES (p_tenant_id, 'Fasteners', 'FAST', 18)
    RETURNING id INTO v_primary_id;
    
    INSERT INTO nomenclature_secondary (tenant_id, primary_id, label, acronym, hint, sort_order) VALUES
    (p_tenant_id, v_primary_id, 'Tapping', 'TAP', 'Tapping type, Size Number x Length, Socket Type, Metal Grade', 1),
    (p_tenant_id, v_primary_id, 'Bolt', 'BLT', 'Type of Head, Diameter & Length, Socket Type, Metal Grade', 2),
    (p_tenant_id, v_primary_id, 'Washer', 'WAS', 'Type of Washer - Spring/Plain, ID-OD-Thickness, Metal Grade', 3),
    (p_tenant_id, v_primary_id, 'Nut', 'NUT', 'ID, Shape, Material Grade', 4),
    (p_tenant_id, v_primary_id, 'Grub', 'GRB', 'Outer Diameter-Length, Type of socket, Metal Grade', 5),
    (p_tenant_id, v_primary_id, 'Thumbolt', 'THB', 'Size OD-Length', 6);

    -- Fuse
    INSERT INTO nomenclature_master (tenant_id, label, acronym, sort_order) 
    VALUES (p_tenant_id, 'Fuse', 'FUS', 19);

    -- Finished Goods
    INSERT INTO nomenclature_master (tenant_id, label, acronym, sort_order) 
    VALUES (p_tenant_id, 'Finished Goods', 'FG', 20);

    -- General Accessories
    INSERT INTO nomenclature_master (tenant_id, label, acronym, hint, sort_order) 
    VALUES (p_tenant_id, 'General Accessories', 'GAC', 'Description', 21);

    -- Heat
    INSERT INTO nomenclature_master (tenant_id, label, acronym, sort_order) 
    VALUES (p_tenant_id, 'Heat', 'HET', 22)
    RETURNING id INTO v_primary_id;
    
    INSERT INTO nomenclature_secondary (tenant_id, primary_id, label, acronym, hint, sort_order) VALUES
    (p_tenant_id, v_primary_id, 'Paste', 'PAS', NULL, 1),
    (p_tenant_id, v_primary_id, 'Pad', 'PAD', NULL, 2),
    (p_tenant_id, v_primary_id, 'Machining', 'MCN', NULL, 3);

    -- Indicator
    INSERT INTO nomenclature_master (tenant_id, label, acronym, sort_order) 
    VALUES (p_tenant_id, 'Indicator', 'IND', 23)
    RETURNING id INTO v_primary_id;
    
    INSERT INTO nomenclature_secondary (tenant_id, primary_id, label, acronym, hint, sort_order) VALUES
    (p_tenant_id, v_primary_id, 'Lipo', 'LIP', 'LIPO Size', 1),
    (p_tenant_id, v_primary_id, 'Surface Mounted Device', 'SMD', 'Voltage, Colour', 2);

    -- Inductor
    INSERT INTO nomenclature_master (tenant_id, label, acronym, sort_order) 
    VALUES (p_tenant_id, 'Inductor', 'IDR', 24)
    RETURNING id INTO v_primary_id;
    
    INSERT INTO nomenclature_secondary (tenant_id, primary_id, label, acronym, sort_order) VALUES
    (p_tenant_id, v_primary_id, 'Surface Mounted Device', 'SMD', 1);

    -- Lubricant
    INSERT INTO nomenclature_master (tenant_id, label, acronym, hint, sort_order) 
    VALUES (p_tenant_id, 'Lubricant', 'LUB', 'Type of Lubricant', 25);

    -- Mechanical Accessories
    INSERT INTO nomenclature_master (tenant_id, label, acronym, sort_order) 
    VALUES (p_tenant_id, 'Mechanical Accessories', 'MAC', 26)
    RETURNING id INTO v_primary_id;
    
    INSERT INTO nomenclature_secondary (tenant_id, primary_id, label, acronym, hint, sort_order) VALUES
    (p_tenant_id, v_primary_id, 'Gland', 'GLA', 'Gland Type, Size', 1),
    (p_tenant_id, v_primary_id, 'Adhesives', 'ADH', 'Type of Adhesive', 2),
    (p_tenant_id, v_primary_id, 'Machining', 'MCN', 'Type of Machining and Other details', 3),
    (p_tenant_id, v_primary_id, 'Bearing', 'BNG', 'Number of Bearing', 4),
    (p_tenant_id, v_primary_id, 'Pnuematic', 'PNE', 'Description', 5),
    (p_tenant_id, v_primary_id, 'Polyutherane Foam', 'PUF', 'Type of Foam', 6);

    -- Module
    INSERT INTO nomenclature_master (tenant_id, label, acronym, sort_order) 
    VALUES (p_tenant_id, 'Module', 'MOD', 27)
    RETURNING id INTO v_primary_id;
    
    INSERT INTO nomenclature_secondary (tenant_id, primary_id, label, acronym, hint, sort_order) VALUES
    (p_tenant_id, v_primary_id, 'GPS/GNSS', 'GNS', NULL, 1),
    (p_tenant_id, v_primary_id, 'Buck Convertor', 'BUK', 'PartNumber, Max Input Voltage, Max Current', 2),
    (p_tenant_id, v_primary_id, 'Power', 'PWR', 'Input Voltage, Output Voltage', 3),
    (p_tenant_id, v_primary_id, 'SD Card', 'SDCard', 'Size of Storage, Type of Card', 4),
    (p_tenant_id, v_primary_id, 'Bluetooth', 'BLE', NULL, 5),
    (p_tenant_id, v_primary_id, 'Charger', 'CHG', 'Input Current, Battery Capacity, Channel', 6),
    (p_tenant_id, v_primary_id, 'Battery Management System', 'BMS', 'Type of Battery, Generation', 7),
    (p_tenant_id, v_primary_id, '3D Printed', '3DP', 'Details of Printed Items', 8),
    (p_tenant_id, v_primary_id, 'Electronic Speed Control', 'ESC', NULL, 9),
    (p_tenant_id, v_primary_id, 'Camera', 'CAM', NULL, 10);

    -- Oscillator
    INSERT INTO nomenclature_master (tenant_id, label, acronym, sort_order) 
    VALUES (p_tenant_id, 'Oscillator', 'OSC', 28);

    -- Printed Circuit Board
    INSERT INTO nomenclature_master (tenant_id, label, acronym, hint, sort_order) 
    VALUES (p_tenant_id, 'Printed Circuit Board', 'PCB', 'Details of PCB where it will be used', 29);

    -- Power
    INSERT INTO nomenclature_master (tenant_id, label, acronym, sort_order) 
    VALUES (p_tenant_id, 'Power', 'PWR', 30)
    RETURNING id INTO v_primary_id;
    
    INSERT INTO nomenclature_secondary (tenant_id, primary_id, label, acronym, hint, sort_order) VALUES
    (p_tenant_id, v_primary_id, 'Block', 'BLK', 'Type of Battery Pack, Capacity', 1),
    (p_tenant_id, v_primary_id, 'Bare Cell', 'BAR', 'Type of Cell, Model Number', 2);

    -- Packaging
    INSERT INTO nomenclature_master (tenant_id, label, acronym, sort_order) 
    VALUES (p_tenant_id, 'Packaging', 'PKG', 31)
    RETURNING id INTO v_primary_id;
    
    INSERT INTO nomenclature_secondary (tenant_id, primary_id, label, acronym, hint, sort_order) VALUES
    (p_tenant_id, v_primary_id, 'Barley Paper', 'BAT', 'Type of Battery', 1),
    (p_tenant_id, v_primary_id, 'Masking', 'MASK', 'Size in Width', 2),
    (p_tenant_id, v_primary_id, 'Duct', 'Duct', NULL, 3);

    -- Resistor
    INSERT INTO nomenclature_master (tenant_id, label, acronym, sort_order) 
    VALUES (p_tenant_id, 'Resistor', 'RES', 32)
    RETURNING id INTO v_primary_id;
    
    INSERT INTO nomenclature_secondary (tenant_id, primary_id, label, acronym, hint, sort_order) VALUES
    (p_tenant_id, v_primary_id, 'Surface Mounted Device', 'SMD', 'Package, Wattage, Tolerance, Value', 1),
    (p_tenant_id, v_primary_id, 'Potentiometer', 'POT', 'Package, Wattage, Tolerance, Value', 2),
    (p_tenant_id, v_primary_id, 'Through-Hole Technology', 'THT', 'Package, Wattage, Tolerance, Value', 3);

    -- Relay
    INSERT INTO nomenclature_master (tenant_id, label, acronym, sort_order) 
    VALUES (p_tenant_id, 'Relay', 'REL', 33)
    RETURNING id INTO v_primary_id;
    
    INSERT INTO nomenclature_secondary (tenant_id, primary_id, label, acronym, hint, sort_order) VALUES
    (p_tenant_id, v_primary_id, 'Power', 'PWR', 'Pole, Voltage, Type', 1),
    (p_tenant_id, v_primary_id, 'Signal', 'SIG', NULL, 2),
    (p_tenant_id, v_primary_id, 'Through-Hole Technology', 'THT', NULL, 3);

    -- Radio
    INSERT INTO nomenclature_master (tenant_id, label, acronym, sort_order) 
    VALUES (p_tenant_id, 'Radio', 'RAD', 34)
    RETURNING id INTO v_primary_id;
    
    INSERT INTO nomenclature_secondary (tenant_id, primary_id, label, acronym, hint, sort_order) VALUES
    (p_tenant_id, v_primary_id, 'Antenna', 'ANT', 'MODEL, WATTAGE, FREQ', 1),
    (p_tenant_id, v_primary_id, 'Transmitter', 'TRR', 'MODEL, WATTAGE, FREQ', 2);

    -- Soldering
    INSERT INTO nomenclature_master (tenant_id, label, acronym, sort_order) 
    VALUES (p_tenant_id, 'Soldering', 'SOL', 35)
    RETURNING id INTO v_primary_id;
    
    INSERT INTO nomenclature_secondary (tenant_id, primary_id, label, acronym, hint, sort_order) VALUES
    (p_tenant_id, v_primary_id, 'Paste', 'PAS', 'Type', 1),
    (p_tenant_id, v_primary_id, 'Wire', 'Wir', 'Type, Gauge', 2),
    (p_tenant_id, v_primary_id, 'Flux', 'FLX', NULL, 3);

    -- Sensor
    INSERT INTO nomenclature_master (tenant_id, label, acronym, sort_order) 
    VALUES (p_tenant_id, 'Sensor', 'SEN', 36)
    RETURNING id INTO v_primary_id;
    
    INSERT INTO nomenclature_secondary (tenant_id, primary_id, label, acronym, hint, sort_order) VALUES
    (p_tenant_id, v_primary_id, 'Water Flow', 'WFL', 'PartNumber, Voltage', 1),
    (p_tenant_id, v_primary_id, 'Current', 'CUR', 'Part Number, core to read quantity, Maximum current allowed', 2),
    (p_tenant_id, v_primary_id, 'Temperature', 'Temp', NULL, 3),
    (p_tenant_id, v_primary_id, 'Leak', 'LEK', NULL, 4),
    (p_tenant_id, v_primary_id, 'Wave', 'WAV', NULL, 5),
    (p_tenant_id, v_primary_id, 'Altimeter', 'ALT', NULL, 6),
    (p_tenant_id, v_primary_id, 'Inertial Measurement Unit', 'IMU', NULL, 7),
    (p_tenant_id, v_primary_id, 'Side Scan Sonar', 'SSS', NULL, 8);

    -- OptoElectronics
    INSERT INTO nomenclature_master (tenant_id, label, acronym, hint, sort_order) 
    VALUES (p_tenant_id, 'OptoElectronics', 'OPE', 'Size, NITS', 37);

    -- Silicon Chip
    INSERT INTO nomenclature_master (tenant_id, label, acronym, sort_order) 
    VALUES (p_tenant_id, 'Silicon Chip', 'SIC', 38)
    RETURNING id INTO v_primary_id;
    
    INSERT INTO nomenclature_secondary (tenant_id, primary_id, label, acronym, hint, sort_order) VALUES
    (p_tenant_id, v_primary_id, 'Diode', 'DIO', 'PN Junction Diode, PartNumber', 1),
    (p_tenant_id, v_primary_id, 'Regulator', 'REG', 'PartNumber, Voltage', 2),
    (p_tenant_id, v_primary_id, 'Comparator', 'COM', NULL, 3),
    (p_tenant_id, v_primary_id, 'Solid State Relay', 'SSR', NULL, 4),
    (p_tenant_id, v_primary_id, 'Buck Convertor', 'Buck', 'Part Number, Max Voltage, Max Current', 5),
    (p_tenant_id, v_primary_id, 'Amplifier IC', 'AMP', 'Part Number, Max Voltage, Max Current, No. of Channels', 6),
    (p_tenant_id, v_primary_id, 'Microprocessor/Microcontroller', 'MPU', NULL, 7);

    -- Sealant
    INSERT INTO nomenclature_master (tenant_id, label, acronym, sort_order) 
    VALUES (p_tenant_id, 'Sealant', 'SLN', 39)
    RETURNING id INTO v_primary_id;
    
    INSERT INTO nomenclature_secondary (tenant_id, primary_id, label, acronym, hint, sort_order) VALUES
    (p_tenant_id, v_primary_id, 'O Ring', 'ORING', 'O Ring Length, Diameter/Size, Shape', 1),
    (p_tenant_id, v_primary_id, 'Shrink Tube', 'STB', 'Size Shrink Factor of dia, Colour, Adhesive lined', 2),
    (p_tenant_id, v_primary_id, 'Silane Modified Polymer', 'SMP', 'Size of the Bottle', 3),
    (p_tenant_id, v_primary_id, 'Room Temperature Vulcanising', 'RTV', 'Size of the Bottle', 4),
    (p_tenant_id, v_primary_id, 'Adhesive', 'ADH', 'Size of Bottle', 5);

    -- Storage
    INSERT INTO nomenclature_master (tenant_id, label, acronym, sort_order) 
    VALUES (p_tenant_id, 'Storage', 'STW', 40);

    -- Sticker
    INSERT INTO nomenclature_master (tenant_id, label, acronym, hint, sort_order) 
    VALUES (p_tenant_id, 'Sticker', 'STX', 'Details of Sticker', 41);

    -- Switch
    INSERT INTO nomenclature_master (tenant_id, label, acronym, sort_order) 
    VALUES (p_tenant_id, 'Switch', 'SWI', 42)
    RETURNING id INTO v_primary_id;
    
    INSERT INTO nomenclature_secondary (tenant_id, primary_id, label, acronym, hint, sort_order) VALUES
    (p_tenant_id, v_primary_id, 'Push Button', 'PUS', 'Momentary Switch, Voltage, Cutout diameter', 1),
    (p_tenant_id, v_primary_id, 'Rotary Switch Button', 'ROT', NULL, 2);

    -- Tools
    INSERT INTO nomenclature_master (tenant_id, label, acronym, sort_order) 
    VALUES (p_tenant_id, 'Tools', 'TOL', 43)
    RETURNING id INTO v_primary_id;
    
    INSERT INTO nomenclature_secondary (tenant_id, primary_id, label, acronym, hint, sort_order) VALUES
    (p_tenant_id, v_primary_id, 'T Handle', 'THD', 'Size', 1),
    (p_tenant_id, v_primary_id, 'Wrench', 'WRE', 'Size', 2);

END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- Migration Complete Message
-- =====================================================
SELECT 'Nomenclature Master tables created successfully!' as message;
SELECT 'Run SELECT seed_nomenclature_data(''your-tenant-id''::UUID); to seed default data' as next_step;
