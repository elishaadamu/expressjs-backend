const express = require("express");
const multer = require("multer");
const cors = require("cors");
const turf = require("@turf/turf");
const fs = require("fs-extra");
const path = require("path");
const proj4 = require("proj4");

const app = express();
const PORT = process.env.PORT || 8000;

// Middleware
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://localhost:5174",
      "https://stbg-projects-highway.netlify.app",
      "https://stbg.onrender.com",
    ],
    credentials: true,
  })
);

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Multer configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "./uploads/"),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});

const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });
fs.ensureDirSync("./uploads");

// Coordinate system definitions
proj4.defs([
  [
    "EPSG:2263",
    "+proj=lcc +lat_0=37.66666666666666 +lon_0=-78.5 +lat_1=36.76666666666667 +lat_2=37.96666666666667 +x_0=3500000 +y_0=2000000 +datum=NAD83 +units=us-ft +no_defs",
  ],
  [
    "EPSG:2283",
    "+proj=lcc +lat_0=37 +lon_0=-78.5 +lat_1=37.48333333333333 +lat_2=38.03333333333333 +x_0=3500000.0001016 +y_0=2000000.0001016 +datum=NAD83 +units=us-ft +no_defs",
  ],
  [
    "EPSG:3857",
    "+proj=merc +a=6378137 +b=6378137 +lat_ts=0.0 +lon_0=0.0 +x_0=0.0 +y_0=0 +k=1.0 +units=m +nadgrids=@null +wktext +no_defs",
  ],
  [
    "EPSG:2264",
    "+proj=lcc +lat_0=36.66666666666666 +lon_0=-79 +lat_1=37.96666666666667 +lat_2=36.76666666666667 +x_0=3500000 +y_0=999999.9999999999 +datum=NAD83 +units=us-ft +no_defs",
  ],
]);

// Helper functions
function loadGeoJSON(filePath) {
  try {
    const data = fs.readJsonSync(filePath);
    console.log(`Loaded ${filePath}: ${data.features?.length || 0} features`);
    return turf.featureCollection(data.features || []);
  } catch (error) {
    console.error(`Error loading ${filePath}:`, error.message);
    return turf.featureCollection([]);
  }
}

function toCRS(featureCollection, targetEPSG) {
  try {
    const sourceEPSG = 4326;
    const newFeatures = featureCollection.features.map((feat) => {
      if (!feat.geometry) return feat;

      try {
        const transformCoord = (coord) => {
          try {
            return proj4(`EPSG:${sourceEPSG}`, `EPSG:${targetEPSG}`, coord);
          } catch (err) {
            console.error("Coordinate transformation error:", err);
            return coord;
          }
        };

        let newGeometry;
        if (feat.geometry.type === "Point") {
          newGeometry = {
            type: "Point",
            coordinates: transformCoord(feat.geometry.coordinates),
          };
        } else if (feat.geometry.type === "LineString") {
          newGeometry = {
            type: "LineString",
            coordinates: feat.geometry.coordinates.map(transformCoord),
          };
        } else if (feat.geometry.type === "Polygon") {
          newGeometry = {
            type: "Polygon",
            coordinates: feat.geometry.coordinates.map((ring) =>
              ring.map(transformCoord)
            ),
          };
        } else if (feat.geometry.type === "MultiPolygon") {
          newGeometry = {
            type: "MultiPolygon",
            coordinates: feat.geometry.coordinates.map((polygon) =>
              polygon.map((ring) => ring.map(transformCoord))
            ),
          };
        } else {
          newGeometry = feat.geometry;
        }

        return { ...feat, geometry: newGeometry };
      } catch (error) {
        console.error("Error transforming feature geometry:", error);
        return feat;
      }
    });
    return turf.featureCollection(newFeatures);
  } catch (error) {
    console.error("Error in toCRS:", error);
    return featureCollection;
  }
}

function createBuffer(feature, distance, units = "meters") {
  try {
    return turf.buffer(feature, distance, { units });
  } catch (error) {
    console.error("Error creating buffer:", error);
    return feature;
  }
}

function getFeaturesInBuffer(
  mainFeature,
  featuresToCheck,
  bufferDistance,
  units = "meters"
) {
  try {
    const buffer = createBuffer(mainFeature, bufferDistance, units);
    const intersected = featuresToCheck.filter((feat) => {
      try {
        return turf.booleanIntersects(feat, buffer);
      } catch (error) {
        return false;
      }
    });
    return intersected;
  } catch (error) {
    console.error("Error in getFeaturesInBuffer:", error);
    return [];
  }
}

// ✅ FIXED: Robust getCentroidsWithin with VALIDATION
function getCentroidsWithin(buffer, features) {
  return features.filter((feat) => {
    try {
      // 1. VALIDATE: Check for required structure
      if (
        !feat ||
        !feat.geometry ||
        !feat.geometry.coordinates ||
        feat.geometry.coordinates.length === 0
      ) {
        return false;
      }

      // 2. VALIDATE: Check ALL coordinates are NUMBERS
      const coords = feat.geometry.coordinates;
      const hasValidCoords = coords.every(
        (coord) =>
          Array.isArray(coord) &&
          coord.every((c) => typeof c === "number" && !isNaN(c))
      );

      if (!hasValidCoords) {
        console.log("⚠️ SKIPPING invalid coordinates:", coords);
        return false;
      }

      // 3. SAFE centroid calculation
      const centroid = turf.centroid(feat);

      // 4. VALIDATE centroid result
      if (!centroid || !centroid.geometry || !centroid.geometry.coordinates) {
        return false;
      }

      return turf.booleanWithin(centroid, buffer);
    } catch (error) {
      console.log("⚠️ SKIPPING feature due to centroid error:", error.message);
      return false;
    }
  });
}

// Debug function to check data
function debugData(files) {
  console.log("\n=== DEBUG DATA ===");
  Object.keys(files).forEach((key) => {
    if (files[key] && files[key].features) {
      console.log(`${key}: ${files[key].features.length} features`);
      if (files[key].features.length > 0) {
        const sample = files[key].features[0];
        console.log(
          `  Sample properties:`,
          Object.keys(sample.properties || {})
        );
        console.log(`  Sample geometry:`, sample.geometry?.type);
      }
    }
  });
  console.log("==================\n");
}

// ✅ FIXED: Debug TAZ data before analysis
function debugTAZData(fc, name) {
  console.log(`\n🔍 DEBUG ${name}:`);
  const valid = fc.features.filter((f) => {
    if (!f.geometry?.coordinates) return false;
    return f.geometry.coordinates.every(
      (coord) =>
        Array.isArray(coord) && coord.every((c) => typeof c === "number")
    );
  });
  console.log(`  Total features: ${fc.features.length}`);
  console.log(`  VALID features: ${valid.length}`);
  console.log(`  INVALID: ${fc.features.length - valid.length}`);

  if (valid.length > 0) {
    console.log(`  Sample VALID:`, valid[0].geometry.coordinates);
  }
  if (fc.features.length > valid.length) {
    console.log(`  Sample INVALID:`, fc.features[0].geometry.coordinates);
  }
}

// Analysis functions
function analyzeSafetyFrequency(projectsFC, crashesFC) {
  console.log("\n=== SAFETY FREQUENCY ANALYSIS ===");

  const results = projectsFC.features.map((proj, i) => {
    const projectId = proj.properties.project_id || i + 1;

    try {
      // Create 250 ft buffer around project
      const buffer = createBuffer(proj, 250, "feet");

      // Find crashes within buffer
      const crashesInBuffer = crashesFC.features.filter((crash) => {
        try {
          return turf.booleanIntersects(crash, buffer);
        } catch (error) {
          return false;
        }
      });

      console.log(
        `Project ${projectId}: Found ${crashesInBuffer.length} crashes in buffer`
      );

      // Calculate crash sums
      const crashSums = crashesInBuffer.reduce(
        (sums, crash) => {
          const props = crash.properties || {};
          return {
            K_PEOPLE: sums.K_PEOPLE + (parseFloat(props.K_PEOPLE) || 0),
            A_PEOPLE: sums.A_PEOPLE + (parseFloat(props.A_PEOPLE) || 0),
            B_PEOPLE: sums.B_PEOPLE + (parseFloat(props.B_PEOPLE) || 0),
            C_PEOPLE: sums.C_PEOPLE + (parseFloat(props.C_PEOPLE) || 0),
          };
        },
        { K_PEOPLE: 0, A_PEOPLE: 0, B_PEOPLE: 0, C_PEOPLE: 0 }
      );

      // Calculate EPDO
      const EPDO =
        crashSums.K_PEOPLE * 2715000 +
        crashSums.A_PEOPLE * 2715000 +
        crashSums.B_PEOPLE * 300000 +
        crashSums.C_PEOPLE * 170000;

      const cmf = parseFloat(proj.properties.cmf) || 0;
      const benefit = EPDO * (1 - cmf);

      console.log(`Project ${projectId}: EPDO=${EPDO}, benefit=${benefit}`);

      return { project_id: projectId, benefit };
    } catch (error) {
      console.error(`Error processing project ${projectId}:`, error);
      return { project_id: projectId, benefit: 0 };
    }
  });

  const maxBenefit = Math.max(0.0001, ...results.map((r) => r.benefit));
  console.log(`Max benefit: ${maxBenefit}`);

  return results.map((r) => ({
    project_id: r.project_id,
    safety_freq: maxBenefit > 0 ? (r.benefit / maxBenefit) * 50 : 0,
  }));
}

function analyzeSafetyRate(projectsFC, crashesFC) {
  console.log("\n=== SAFETY RATE ANALYSIS ===");

  const results = projectsFC.features.map((proj, i) => {
    const projectId = proj.properties.project_id || i + 1;

    try {
      // Get benefit from safety frequency analysis
      const buffer = createBuffer(proj, 250, "feet");
      const crashesInBuffer = crashesFC.features.filter((crash) => {
        try {
          return turf.booleanIntersects(crash, buffer);
        } catch (error) {
          return false;
        }
      });

      const crashSums = crashesInBuffer.reduce(
        (sums, crash) => {
          const props = crash.properties || {};
          return {
            K_PEOPLE: sums.K_PEOPLE + (parseFloat(props.K_PEOPLE) || 0),
            A_PEOPLE: sums.A_PEOPLE + (parseFloat(props.A_PEOPLE) || 0),
            B_PEOPLE: sums.B_PEOPLE + (parseFloat(props.B_PEOPLE) || 0),
            C_PEOPLE: sums.C_PEOPLE + (parseFloat(props.C_PEOPLE) || 0),
          };
        },
        { K_PEOPLE: 0, A_PEOPLE: 0, B_PEOPLE: 0, C_PEOPLE: 0 }
      );

      const EPDO =
        crashSums.K_PEOPLE * 2715000 +
        crashSums.A_PEOPLE * 2715000 +
        crashSums.B_PEOPLE * 300000 +
        crashSums.C_PEOPLE * 170000;

      const cmf = parseFloat(proj.properties.cmf) || 0;
      const benefit = EPDO * (1 - cmf);

      // Calculate VMT based on project type
      const projectType = (proj.properties.type || "highway").toLowerCase();
      const AADT = parseFloat(proj.properties.AADT) || 0;
      const length = parseFloat(proj.properties.length) || 1;

      let vmt = 1;
      if (projectType === "highway") {
        vmt = (AADT * length * 365) / 100000000;
      } else if (projectType === "intersection") {
        vmt = (AADT * 365) / 1000000;
      }

      const epdoRate = vmt > 0 ? benefit / vmt : 0;
      console.log(`Project ${projectId}: VMT=${vmt}, epdoRate=${epdoRate}`);

      return { project_id: projectId, epdo_rate: epdoRate };
    } catch (error) {
      console.error(`Error processing project ${projectId}:`, error);
      return { project_id: projectId, epdo_rate: 0 };
    }
  });

  const maxRate = Math.max(0.0001, ...results.map((r) => r.epdo_rate));
  console.log(`Max epdo_rate: ${maxRate}`);

  return results.map((r) => ({
    project_id: r.project_id,
    safety_rate: maxRate > 0 ? (r.epdo_rate / maxRate) * 50 : 0,
  }));
}

function analyzeCongestionDemand(projectsFC, aadtFC) {
  console.log("\n=== CONGESTION DEMAND ANALYSIS ===");

  const results = projectsFC.features.map((proj, i) => {
    const projectId = proj.properties.project_id || i + 1;

    try {
      // Create 0.25 mile buffer
      const buffer = createBuffer(proj, 0.25, "miles");

      // Find AADT segments within buffer
      const intersected = aadtFC.features.filter((seg) => {
        try {
          return turf.booleanIntersects(seg, buffer);
        } catch (error) {
          return false;
        }
      });

      console.log(
        `Project ${projectId}: Found ${intersected.length} AADT segments`
      );

      let totalVMT = 0;
      let totalLength = 0;

      intersected.forEach((seg) => {
        try {
          const aadt =
            parseFloat(seg.properties.aadt_0 || seg.properties.AADT) || 0;
          const lengthMiles = turf.length(seg, { units: "miles" }) || 0;
          totalVMT += aadt * lengthMiles;
          totalLength += lengthMiles;
        } catch (error) {
          console.error("Error processing AADT segment:", error);
        }
      });

      const waAadt = totalLength > 0 ? totalVMT / totalLength : 0;
      console.log(`Project ${projectId}: waAadt=${waAadt}`);

      return { project_id: projectId, wa_aadt: waAadt };
    } catch (error) {
      console.error(`Error processing project ${projectId}:`, error);
      return { project_id: projectId, wa_aadt: 0 };
    }
  });

  const maxAadt = Math.max(0.0001, ...results.map((r) => r.wa_aadt));
  console.log(`Max wa_aadt: ${maxAadt}`);

  return results.map((r) => ({
    project_id: r.project_id,
    cong_demand: maxAadt > 0 ? (r.wa_aadt / maxAadt) * 10 : 0,
  }));
}

function analyzeCongestionLos(projectsFC, aadtFC) {
  console.log("\n=== CONGESTION LOS ANALYSIS ===");

  const losMapping = { A: 0, B: 1, C: 2, D: 3, E: 3, F: 3 };

  const results = projectsFC.features.map((proj, i) => {
    const projectId = proj.properties.project_id || i + 1;

    try {
      const buffer = createBuffer(proj, 0.25, "miles");
      const intersected = aadtFC.features.filter((seg) => {
        try {
          return turf.booleanIntersects(seg, buffer);
        } catch (error) {
          return false;
        }
      });

      const sumCongValue = intersected.reduce((sum, seg) => {
        const los = (seg.properties.los_0 || "A").toUpperCase();
        return sum + (losMapping[los] || 0);
      }, 0);

      console.log(`Project ${projectId}: sum_cong_value=${sumCongValue}`);

      return { project_id: projectId, sum_cong_value: sumCongValue };
    } catch (error) {
      console.error(`Error processing project ${projectId}:`, error);
      return { project_id: projectId, sum_cong_value: 0 };
    }
  });

  const maxSum = Math.max(0.0001, ...results.map((r) => r.sum_cong_value));
  console.log(`Max sum_cong_value: ${maxSum}`);

  return results.map((r) => ({
    project_id: r.project_id,
    cong_los: maxSum > 0 ? (r.sum_cong_value / maxSum) * 5 : 0,
  }));
}

// ✅ FIXED: analyzeEquityAccessJobs
function analyzeEquityAccessJobs(projectsFC, popempFC) {
  console.log("\n=== EQUITY ACCESS JOBS ANALYSIS ===");

  // DEBUG TAZ DATA FIRST
  debugTAZData(popempFC, "POPEMP/TAZ");

  const fcDistancesMiles = { PA: 10, MA: 7.5, MC: 5 };
  const results = projectsFC.features.map((proj, i) => {
    const projectId = proj.properties.project_id || i + 1;

    try {
      const fc = proj.properties.fc || "MC";
      const bufferDistMiles = fcDistancesMiles[fc] || 5;
      const buffer = createBuffer(proj, bufferDistMiles, "miles");

      // USE FIXED FUNCTION
      const selected = getCentroidsWithin(buffer, popempFC.features);
      console.log(`Project ${projectId}: Found ${selected.length} VALID TAZs`);

      const sumEmp17 = selected.reduce(
        (sum, taz) => sum + (parseFloat(taz.properties?.emp17) || 0),
        0
      );
      const sumEmp50 = selected.reduce(
        (sum, taz) => sum + (parseFloat(taz.properties?.emp50) || 0),
        0
      );

      const pctChange =
        sumEmp17 > 0 ? ((sumEmp50 - sumEmp17) / sumEmp17) * 100 : 0;
      console.log(
        `Project ${projectId}: emp17=${sumEmp17}, emp50=${sumEmp50}, pct=${pctChange}`
      );

      return { project_id: projectId, pct_change: pctChange };
    } catch (error) {
      console.error(`❌ Project ${projectId} error:`, error.message);
      return { project_id: projectId, pct_change: 0 };
    }
  });

  const maxPct = Math.max(0.0001, ...results.map((r) => r.pct_change));
  console.log(`Max pct_change: ${maxPct}`);

  return results.map((r) => ({
    project_id: r.project_id,
    jobs_pc: maxPct > 0 ? (r.pct_change / maxPct) * 5 : 0,
  }));
}

// Add other analysis functions with similar error handling...

function analyzeEquityAccessJobsEJ(projectsFC, popempFC, ejFC) {
  console.log("\n=== EQUITY ACCESS JOBS EJ ANALYSIS ===");
  const fcDistancesMiles = { PA: 10, MA: 7.5, MC: 5 };

  const results = projectsFC.features.map((proj, i) => {
    const projectId = proj.properties.project_id || i + 1;

    try {
      const fc = proj.properties.fc || "MC";
      const bufferDistMiles = fcDistancesMiles[fc] || 5;
      const buffer = createBuffer(proj, bufferDistMiles, "miles");

      // For now, return basic calculation - implement EJ logic later
      const selected = getCentroidsWithin(buffer, popempFC.features);
      const sumEmp17 = selected.reduce(
        (sum, taz) => sum + (parseFloat(taz.properties.emp17) || 0),
        0
      );
      const sumEmp50 = selected.reduce(
        (sum, taz) => sum + (parseFloat(taz.properties.emp50) || 0),
        0
      );

      const pctChange =
        sumEmp17 > 0 ? ((sumEmp50 - sumEmp17) / sumEmp17) * 100 : 0;

      return { project_id: projectId, pct_change: pctChange };
    } catch (error) {
      console.error(`Error processing project ${projectId}:`, error);
      return { project_id: projectId, pct_change: 0 };
    }
  });

  const maxPct = Math.max(0.0001, ...results.map((r) => r.pct_change));
  return results.map((r) => ({
    project_id: r.project_id,
    jobs_pc_ej: maxPct > 0 ? (r.pct_change / maxPct) * 5 : 0,
  }));
}

// Simplified versions of other analysis functions for testing
function analyzeAccessNonWork(projectsFC, popempFC, nwFC) {
  console.log("\n=== ACCESS NON-WORK ANALYSIS ===");

  const results = projectsFC.features.map((proj, i) => {
    const projectId = proj.properties.project_id || i + 1;
    return { project_id: projectId, access_nw_norm: Math.random() * 5 }; // Temporary
  });

  return results;
}

function analyzeAccessNonWorkEJ(projectsFC, popempFC, nwFC, ejFC) {
  console.log("\n=== ACCESS NON-WORK EJ ANALYSIS ===");

  const results = projectsFC.features.map((proj, i) => {
    const projectId = proj.properties.project_id || i + 1;
    return { project_id: projectId, access_nw_ej_norm: Math.random() * 5 }; // Temporary
  });

  return results;
}

function analyzeSensitiveFeatures(projectsFC, fhzFC, frskFC, wetFC, conFC) {
  console.log("\n=== SENSITIVE FEATURES ANALYSIS ===");

  const results = projectsFC.features.map((proj, i) => {
    const projectId = proj.properties.project_id || i + 1;
    const tier = (proj.properties.tier || "").toUpperCase();

    // Simple tier-based scoring for testing
    let envScore = 10;
    if (tier === "EIS") envScore = 5;
    else if (tier === "EA") envScore = 7;
    else if (tier === "CE") envScore = 9;

    return { project_id: projectId, env_impact_score: envScore };
  });

  return results;
}

function analyzeJobGrowth(projectsFC, popempFC) {
  console.log("\n=== JOB GROWTH ANALYSIS ===");

  const results = projectsFC.features.map((proj, i) => {
    const projectId = proj.properties.project_id || i + 1;
    return { project_id: projectId, job_growth_score: Math.random() * 10 }; // Temporary
  });

  return results;
}

// ✅ FIXED: analyzeFreightJobs (for LEHD file)
function analyzeFreightJobs(projectsFC, lehdFC) {
  console.log("\n=== FREIGHT JOBS ANALYSIS ===");

  debugTAZData(lehdFC, "LEHD/FREIGHT");

  const bufferDist = 5; // miles
  const results = projectsFC.features.map((proj, i) => {
    const projectId = proj.properties.project_id || i + 1;

    try {
      const buffer = createBuffer(proj, bufferDist, "miles");
      const selected = getCentroidsWithin(buffer, lehdFC.features);

      console.log(
        `Project ${projectId}: freight_jobs=${selected.length} VALID`
      );

      return {
        project_id: projectId,
        freight_jobs: selected.length,
      };
    } catch (error) {
      console.error(`❌ Freight ${projectId} error:`, error.message);
      return { project_id: projectId, freight_jobs: 0 };
    }
  });

  const maxJobs = Math.max(0.0001, ...results.map((r) => r.freight_jobs));
  console.log(`Max freight_jobs: ${maxJobs}`);

  return results.map((r) => ({
    project_id: r.project_id,
    freight_score: maxJobs > 0 ? (r.freight_jobs / maxJobs) * 10 : 0,
  }));
}

// ✅ FIXED: analyzeActivityCenters
function analyzeActivityCenters(projectsFC, actvFC) {
  console.log("\n=== ACTIVITY CENTERS ANALYSIS ===");

  debugTAZData(actvFC, "ACTIVITY");

  const bufferDist = 2; // miles
  const results = projectsFC.features.map((proj, i) => {
    const projectId = proj.properties.project_id || i + 1;

    try {
      const buffer = createBuffer(proj, bufferDist, "miles");
      const selected = getCentroidsWithin(buffer, actvFC.features);

      console.log(`Project ${projectId}: actv_count=${selected.length} VALID`);

      return {
        project_id: projectId,
        actv_count: selected.length,
      };
    } catch (error) {
      console.error(`❌ Activity ${projectId} error:`, error.message);
      return { project_id: projectId, actv_count: 0 };
    }
  });

  const maxCount = Math.max(0.0001, ...results.map((r) => r.actv_count));
  console.log(`Max actv_count: ${maxCount}`);

  return results.map((r) => ({
    project_id: r.project_id,
    activity_score: maxCount > 0 ? (r.actv_count / maxCount) * 10 : 0,
  }));
}

// Add this helper function
function cleanGeoJSON(fc, name) {
  const cleaned = fc.features.filter((feat) => {
    try {
      if (!feat.geometry?.coordinates) return false;
      const valid = feat.geometry.coordinates.every(
        (coord) =>
          Array.isArray(coord) && coord.every((c) => typeof c === "number")
      );
      if (!valid)
        console.log(`🧹 Cleaned invalid ${name}:`, feat.geometry.coordinates);
      return valid;
    } catch {
      return false;
    }
  });
  console.log(
    `🧹 ${name}: Kept ${cleaned.length}/${fc.features.length} features`
  );
  return turf.featureCollection(cleaned);
}

async function runAnalysis(filePaths, outputDir) {
  console.log("Starting highway projects analysis...");

  try {
    // Load all files
    const files = {
      projects: loadGeoJSON(filePaths.projects),
      crashes: loadGeoJSON(filePaths.crashes),
      aadt: loadGeoJSON(filePaths.aadt),
      popemp: loadGeoJSON(filePaths.popemp),
      t6: loadGeoJSON(filePaths.t6),
      nw: loadGeoJSON(filePaths.nw),
      fhz: loadGeoJSON(filePaths.fhz),
      frsk: loadGeoJSON(filePaths.frsk),
      wet: loadGeoJSON(filePaths.wet),
      con: loadGeoJSON(filePaths.con),
      lehd: filePaths.lehd
        ? loadGeoJSON(filePaths.lehd)
        : turf.featureCollection([]),
      actv: filePaths.actv
        ? loadGeoJSON(filePaths.actv)
        : turf.featureCollection([]),
    };

    // Debug: Check what data we have
    debugData(files);

    // Clean GeoJSON files
    files.popemp = cleanGeoJSON(files.popemp, "POPEMP");
    files.lehd = cleanGeoJSON(files.lehd, "LEHD");
    files.actv = cleanGeoJSON(files.actv, "ACTIVITY");

    // Add project_id if not present
    files.projects.features = files.projects.features.map((feat, i) => ({
      ...feat,
      properties: {
        ...feat.properties,
        project_id: feat.properties.project_id || i + 1,
        // Ensure required properties exist
        type: feat.properties.type || "unknown",
        county: feat.properties.county || "unknown",
        cost_mil: parseFloat(feat.properties.cost_mil) || 1,
        tier: feat.properties.tier || "unknown",
        fc: feat.properties.fc || "MC",
        cmf: parseFloat(feat.properties.cmf) || 0,
        AADT: parseFloat(feat.properties.AADT) || 0,
        length: parseFloat(feat.properties.length) || 1,
      },
    }));

    // Run analyses
    const analyses = [
      {
        name: "safety_freq",
        fn: analyzeSafetyFrequency,
        args: [files.projects, files.crashes],
      },
      {
        name: "safety_rate",
        fn: analyzeSafetyRate,
        args: [files.projects, files.crashes],
      },
      {
        name: "cong_demand",
        fn: analyzeCongestionDemand,
        args: [files.projects, files.aadt],
      },
      {
        name: "cong_los",
        fn: analyzeCongestionLos,
        args: [files.projects, files.aadt],
      },
      {
        name: "jobs_pc",
        fn: analyzeEquityAccessJobs,
        args: [files.projects, files.popemp],
      },
      {
        name: "jobs_pc_ej",
        fn: analyzeEquityAccessJobsEJ,
        args: [files.projects, files.popemp, files.t6],
      },
      {
        name: "access_nw_norm",
        fn: analyzeAccessNonWork,
        args: [files.projects, files.popemp, files.nw],
      },
      {
        name: "access_nw_ej_norm",
        fn: analyzeAccessNonWorkEJ,
        args: [files.projects, files.popemp, files.nw, files.t6],
      },
      {
        name: "env_impact_score",
        fn: analyzeSensitiveFeatures,
        args: [files.projects, files.fhz, files.frsk, files.wet, files.con],
      },
      {
        name: "job_growth_score",
        fn: analyzeJobGrowth,
        args: [files.projects, files.popemp],
      },
      {
        name: "freight_score",
        fn: analyzeFreightJobs, // ✅ FIXED
        args: [files.projects, files.lehd],
      },
      {
        name: "activity_score",
        fn: analyzeActivityCenters, // ✅ FIXED
        args: [files.projects, files.actv],
      },
    ];

    // Initialize results
    const resultsMap = new Map();
    files.projects.features.forEach((feat) => {
      const pid = feat.properties.project_id;
      resultsMap.set(pid, {
        ...feat.properties,
        geometry: feat.geometry,
        // Initialize all scores to non-zero values for testing
        safety_freq: 1,
        safety_rate: 1,
        cong_demand: 1,
        cong_los: 1,
        jobs_pc: 1,
        jobs_pc_ej: 1,
        access_nw_norm: 1,
        access_nw_ej_norm: 1,
        env_impact_score: 1,
        job_growth_score: 1,
        freight_score: 1,
        activity_score: 1,
      });
    });

    // Run analyses
    for (const analysis of analyses) {
      console.log(`\nRunning ${analysis.name}...`);
      try {
        const result = analysis.fn(...analysis.args);
        console.log(`${analysis.name} results:`, result);

        result.forEach((res) => {
          const pid = res.project_id;
          if (resultsMap.has(pid)) {
            resultsMap.set(pid, { ...resultsMap.get(pid), ...res });
          }
        });
      } catch (error) {
        console.error(`Error in ${analysis.name}:`, error);
      }
    }

    // Calculate totals and rankings
    let finalData = Array.from(resultsMap.values());
    const scoreColumns = [
      "safety_freq",
      "safety_rate",
      "cong_demand",
      "cong_los",
      "jobs_pc",
      "jobs_pc_ej",
      "access_nw_norm",
      "access_nw_ej_norm",
      "env_impact_score",
      "job_growth_score",
      "freight_score",
      "activity_score",
    ];

    finalData = finalData.map((project) => {
      scoreColumns.forEach((col) => {
        project[col] = parseFloat(project[col] || 0);
      });
      project.total_score = scoreColumns.reduce(
        (sum, col) => sum + project[col],
        0
      );
      project.cost_mil = parseFloat(project.cost_mil || 1);
      project.bcr =
        project.cost_mil > 0 ? project.total_score / project.cost_mil : 0;
      return project;
    });

    // Sort by BCR and assign ranks
    finalData.sort((a, b) => b.bcr - a.bcr);
    finalData.forEach((proj, i) => {
      proj.rank = i + 1;
    });

    // Prepare response
    const results = finalData.map((proj) => ({
      project_id: proj.project_id,
      type: proj.type,
      county: proj.county,
      cost_mil: proj.cost_mil,
      tier: proj.tier,
      ...Object.fromEntries(scoreColumns.map((col) => [col, proj[col]])),
      total_score: proj.total_score,
      bcr: proj.bcr,
      rank: proj.rank,
    }));

    console.log("\n=== FINAL RESULTS ===");
    console.log(JSON.stringify(results, null, 2));

    return {
      projects: results,
      summary: {
        total_projects: results.length,
        total_cost: finalData.reduce((sum, p) => sum + p.cost_mil, 0),
      },
    };
  } catch (error) {
    console.error("Analysis error:", error);
    throw error;
  }
}

// Routes
app.get("/", (req, res) => {
  res.json({ message: "Welcome to the STBG Project Prioritization API" });
});

app.post(
  "/analyze",
  upload.fields([
    { name: "projects_file", maxCount: 1 },
    { name: "crashes_file", maxCount: 1 },
    { name: "aadt_file", maxCount: 1 },
    { name: "popemp_file", maxCount: 1 },
    { name: "actv_file", maxCount: 1 },
    { name: "con_file", maxCount: 1 },
    { name: "fhz_file", maxCount: 1 },
    { name: "frsk_file", maxCount: 1 },
    { name: "lehd_file", maxCount: 1 },
    { name: "nw_file", maxCount: 1 },
    { name: "t6_file", maxCount: 1 },
    { name: "wet_file", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      if (!req.files) {
        return res.status(400).json({ error: "No files uploaded" });
      }

      const filePaths = {};
      Object.keys(req.files).forEach((key) => {
        if (req.files[key]) {
          filePaths[key.replace("_file", "")] = req.files[key][0].path;
        }
      });

      const requiredFiles = [
        "projects",
        "crashes",
        "aadt",
        "popemp",
        "t6",
        "nw",
        "fhz",
        "frsk",
        "wet",
        "con",
      ];
      const missingFiles = requiredFiles.filter((file) => !filePaths[file]);
      if (missingFiles.length > 0) {
        return res
          .status(400)
          .json({ error: "Missing required files", missing: missingFiles });
      }

      const outputDir = path.resolve("./uploads");
      const results = await runAnalysis(filePaths, outputDir);

      res.json(results);
    } catch (error) {
      console.error("Analysis endpoint error:", error);
      res
        .status(500)
        .json({ error: "Analysis failed", details: error.message });
    }
  }
);

app.listen(PORT, () => {
  console.log(`STBG API running on port ${PORT}`);
});
