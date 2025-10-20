import React, { useState, useCallback } from "react";
import {
  Upload,
  X,
  FileText,
  TrendingUp,
  AlertCircle,
  Download,
  Play,
  CheckCircle2,
} from "lucide-react";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { Link } from "react-router-dom";
import ResultsTable from "../ResultsTable";

import "./App.css";

const STBGFrontend = () => {
  const [files, setFiles] = useState({});
  const [processing, setProcessing] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);
  const [step, setStep] = useState("upload"); // upload, processing, results

  const requiredFiles = [
    {
      key: "projects",
      name: "Projects",
      description: "Main project locations with attributes",
    },
    { key: "crashes", name: "Crashes", description: "Crashes" },
    { key: "aadt", name: "AADT", description: "AADT" },
    {
      key: "popemp",
      name: "Population",
      description: "Population and Employment TAZ",
    },
    {
      key: "actv",
      name: "Activity Centers",
      description: "Activity Centers",
    },
    {
      key: "con",
      name: "Conservation Lands",
      description: "Conservation Lands",
    },
    {
      key: "fhz",
      name: "Flood Hazard",
      description: "Flood Hazard Zones",
    },
    {
      key: "frsk",
      name: "Flood Risk",
      description: "Flood Risk Areas",
    },
    { key: "lehd", name: "LEHD", description: "LEHD" },
    {
      key: "nw",
      name: "Non-Work Destinations",
      description: "Non-Work Destinations",
    },
    {
      key: "t6",
      name: "Environmental Justice",
      description: "Environmental Justice areas",
    },
    { key: "wet", name: "Wetlands", description: "Wetlands" },
  ];

  const handleFileUpload = useCallback((fileKey, file) => {
    if (file) {
      setFiles((prev) => ({
        ...prev,
        [fileKey]: file,
      }));
    }
  }, []);

  const removeFile = useCallback((fileKey) => {
    setFiles((prev) => {
      const newFiles = { ...prev };
      delete newFiles[fileKey];
      return newFiles;
    });
  }, []);

  const loadSampleFiles = async () => {
    setProcessing(true);
    setError(null);
    try {
      const fileKeys = {
        projects: "projects.geojson",
        crashes: "crashes.geojson",
        aadt: "aadt.geojson",
        popemp: "popemp.geojson",
        actv: "actv.geojson", // This was con.geojson
        con: "con.geojson",
        congestion: "congestion.geojson", // Added for completeness, not used in analysis
        fhz: "fhz.geojson",
        frsk: "frsk.geojson",
        lehd: "lehd.geojson",
        nw: "nw.geojson",
        t6: "t6.geojson",
        wet: "wet.geojson",
      };

      const filePromises = Object.entries(fileKeys).map(
        async ([key, filename]) => {
          const response = await fetch(`/stbg_elijah/${filename}`);

          console.log(response);
          const blob = await response.blob();
          return [
            key,
            new File([blob], filename, { type: "application/geo+json" }),
          ];
        }
      );

      const fileEntries = await Promise.all(filePromises);
      const newFiles = Object.fromEntries(fileEntries);

      setFiles(newFiles);
      toast.success("Data loaded successfully!", {
        position: "top-right",
        autoClose: 3000,
        hideProgressBar: false,
        closeOnClick: true,
        pauseOnHover: true,
        draggable: true,
        progress: undefined,
      });
    } catch (err) {
      setError(`Failed to load data: ${err.message}`);
      toast.error(`Failed to load  data: ${err.message}`, {
        position: "top-right",
        autoClose: 5000,
        hideProgressBar: false,
        closeOnClick: true,
        pauseOnHover: true,
        draggable: true,
        progress: undefined,
      });
    } finally {
      setProcessing(false);
    }
  };

  const processData = async () => {
    setProcessing(true);
    setError(null);
    setStep("processing");
    toast.info("Loading API and processing data...", {
      position: "top-right",
      autoClose: false, // Don't auto close, will be updated on success/error
      hideProgressBar: false,
      closeOnClick: false,
      pauseOnHover: false,
      draggable: true,
      progress: undefined,
      toastId: "processingToast", // Unique ID to update this toast later
    });

    const formData = new FormData();
    formData.append("projects_file", files.projects);
    formData.append("crashes_file", files.crashes);
    formData.append("aadt_file", files.aadt);
    formData.append("popemp_file", files.popemp);
    formData.append("actv_file", files.actv);
    formData.append("con_file", files.con); // Ensure this key matches the backend expectation
    formData.append("fhz_file", files.fhz);
    formData.append("frsk_file", files.frsk);
    formData.append("lehd_file", files.lehd);
    formData.append("nw_file", files.nw);
    formData.append("t6_file", files.t6);
    formData.append("wet_file", files.wet);

    try {
      const response = await fetch("http://127.0.0.1:8000/analyze", {
        method: "POST",
        body: formData,
      });

      const results = await response.json();
      console.log(results);
      setResults(results);
      setStep("results");
      toast.update("processingToast", {
        render: "API loaded and data processed successfully!",
        type: "success",
        autoClose: 3000,
        hideProgressBar: false,
        closeOnClick: true,
        pauseOnHover: true,
        draggable: true,
        progress: undefined,
      });
    } catch (err) {
      setError("Failed to process data: " + err.message);
      console.error(err);
      setStep("upload");
      toast.update("processingToast", {
        render: `Failed to process data: ${err.message}`,
        type: "error",
        autoClose: 5000,
        hideProgressBar: false,
        closeOnClick: true,
        pauseOnHover: true,
        draggable: true,
        progress: undefined,
      });
    } finally {
      setProcessing(false);
    }
  };

  const downloadResults = () => {
    if (!results || !results.projects || results.projects.length === 0) {
      toast.warn("No results to download.", { position: "top-right" });
      return;
    }

    const projects = results.projects;
    const headers = Object.keys(projects[0]);
    const csvRows = [headers.join(",")];

    for (const row of projects) {
      const values = headers.map((header) => {
        const escaped = ("" + row[header]).replace(/"/g, '""'); // Escape double quotes
        return `"${escaped}"`; // Quote all fields
      });
      csvRows.push(values.join(","));
    }

    const csvString = csvRows.join("\n");
    const blob = new Blob([csvString], { type: "text/csv;charset=utf-8;" });

    const link = document.createElement("a");
    if (link.download !== undefined) {
      // Browsers that support HTML5 download attribute
      const url = URL.createObjectURL(blob);
      link.setAttribute("href", url);
      link.setAttribute("download", "stbg_results.csv");
      link.style.visibility = "hidden";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  const FileUploadCard = ({ fileInfo }) => {
    const [isDragging, setIsDragging] = useState(false);
    const hasFile = files[fileInfo.key];

    const handleDragOver = useCallback((event) => {
      event.preventDefault();
      setIsDragging(true);
    }, []);

    const handleDragLeave = useCallback(() => {
      setIsDragging(false);
    }, []);

    const handleDrop = useCallback(
      (event) => {
        event.preventDefault();
        setIsDragging(false);
        const droppedFile = event.dataTransfer.files[0];
        if (droppedFile) {
          handleFileUpload(fileInfo.key, droppedFile);
        }
      },
      [fileInfo.key, handleFileUpload]
    );

    const formatBytes = (bytes, decimals = 2) => {
      if (bytes === 0) return "0 Bytes";
      const k = 1024;
      const dm = decimals < 0 ? 0 : decimals;
      const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
    };

    return (
      <div
        className={`relative flex flex-col items-center justify-center h-48 p-4 border-2 rounded-lg transition-all duration-300 ease-in-out
          ${
            hasFile
              ? "border-green-500 bg-green-50 shadow-md"
              : isDragging
              ? "border-blue-500 bg-blue-50 shadow-lg"
              : "border-dashed border-gray-300 bg-white hover:border-blue-500 hover:bg-blue-50"
          } cursor-pointer`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {hasFile ? (
          <div className="flex flex-col items-center space-y-2 text-center">
            <CheckCircle2 className="h-8 w-8 text-green-600" />
            <span className="text-base font-semibold text-green-800 px-2">
              {fileInfo.name}
            </span>
            <span className="text-sm text-gray-600">
              ({formatBytes(files[fileInfo.key].size)})
            </span>
            <button
              onClick={() => removeFile(fileInfo.key)}
              className="absolute top-2 right-2 text-gray-600 hover:text-red-500 p-1 rounded-full bg-white/70 hover:bg-white focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-opacity-50"
              aria-label="Remove file"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ) : (
          <label className="flex flex-col items-center justify-center space-y-2 w-full h-full text-center px-4">
            <Upload
              className={`h-10 w-10 ${
                isDragging ? "text-blue-600" : "text-blue-500"
              }`}
            />
            <span className="text-base font-medium text-gray-700 text-center">
              Drag & Drop or{" "}
              <span className="text-blue-600 hover:underline">Browse</span>
            </span>
            <span className="text-sm font-bold text-gray-500 mt-1">
              {fileInfo.name}
            </span>
            <input
              type="file"
              className="hidden"
              accept=".geojson,.json,.shp"
              onChange={(e) =>
                handleFileUpload(fileInfo.key, e.target.files[0])
              }
            />
          </label>
        )}
      </div>
    );
  };

  return (
    <div className="bg-indigo-50">
      <ToastContainer
        theme="colored"
        position="top-right"
        autoClose={5000}
        hideProgressBar={false}
        newestOnTop={false}
        closeOnClick
        rtl={false}
        pauseOnFocusLoss
        draggable
        pauseOnHover
      />
      <nav className="bg-white dark:bg-gray-800 shadow-sm p-3  border-b border-indigo-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <Link to="/" className="flex items-center space-x-2">
            <div>
              {" "}
              <img src="/MPO_Logo.jpg" alt="MPO Logo" className="w-24" />
            </div>
          </Link>
          <h2 className="text-base  md:text-[24px] font-bold text-gray-900 dark:text-gray-100">
            Project Prioritization Tool
          </h2>
        </div>
      </nav>
      <div className="flex wrap justify-center mb-8 gap-4 mt-6">
        <button
          onClick={loadSampleFiles}
          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-gray-600 hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
        >
          Load Data
        </button>
        <button
          onClick={processData}
          disabled={
            Object.keys(files).length < requiredFiles.length || processing
          }
          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-blue-500 dark:hover:bg-blue-600"
        >
          <Play className="w-4 h-4 mr-2" />
          Run Analysis
        </button>

        <button
          onClick={() => {
            setStep("upload");
            setResults(null);
            setFiles({});
          }}
          className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md shadow-sm text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600 dark:hover:bg-gray-600"
        >
          Start New Analysis
        </button>
      </div>

      <div className="max-w-screen-xl mx-auto px-4 sm:px-6 lg:px-8 py-5">
        {/* Progress Indicator */}
        <div className="flex justify-center mb-8">
          <div className="flex items-center space-x-4">
            <div
              className={`flex items-center ${
                step === "upload"
                  ? "text-blue-600 dark:text-blue-400"
                  : "text-green-600 dark:text-green-400"
              }`}
            >
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center ${
                  step === "upload"
                    ? "bg-blue-100 dark:bg-blue-900/50"
                    : "bg-green-100 dark:bg-green-900/50"
                }`}
              >
                {step === "upload" ? (
                  <Upload className="w-4 h-4" />
                ) : (
                  <CheckCircle2 className="w-4 h-4" />
                )}
              </div>
              <span className="ml-2 text-sm font-medium dark:text-gray-300">
                Upload Data
              </span>
            </div>
            <div className="w-8 h-0.5 bg-gray-300 dark:bg-gray-600"></div>
            <div
              className={`flex items-center ${
                step === "processing"
                  ? "text-blue-600 dark:text-blue-400"
                  : step === "results"
                  ? "text-green-600 dark:text-green-400"
                  : "text-gray-400 dark:text-gray-500"
              }`}
            >
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center ${
                  step === "processing"
                    ? "bg-blue-100 dark:bg-blue-900/50"
                    : step === "results"
                    ? "bg-green-100 dark:bg-green-900/50"
                    : "bg-gray-100 dark:bg-gray-700"
                }`}
              >
                <TrendingUp className="w-4 h-4" />
              </div>
              <span className="ml-2 text-sm font-medium dark:text-gray-300">
                Process
              </span>
            </div>
            <div className="w-8 h-0.5 bg-gray-300 dark:bg-gray-600"></div>
            <div
              className={`flex items-center ${
                step === "results"
                  ? "text-green-600 dark:text-green-400"
                  : "text-gray-400 dark:text-gray-500"
              }`}
            >
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center ${
                  step === "results"
                    ? "bg-green-100 dark:bg-green-900/50"
                    : "bg-gray-100 dark:bg-gray-700"
                }`}
              >
                <FileText className="w-4 h-4" />
              </div>
              <span className="ml-2 text-sm font-medium dark:text-gray-300">
                Results
              </span>
            </div>
          </div>
        </div>

        {/* Upload Section */}
        {step === "upload" && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 mb-6">
            {error && (
              <div className="mb-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-500/30 rounded-md">
                <div className="flex">
                  <AlertCircle className="h-5 w-5 text-red-400 dark:text-red-500" />
                  <div className="ml-3">
                    <p className="text-sm text-red-800 dark:text-red-200">
                      {error}
                    </p>
                  </div>
                </div>
              </div>
            )}
            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">
              Upload Required Data Files
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4 mb-6">
              {requiredFiles.map((fileInfo) => (
                <FileUploadCard key={fileInfo.key} fileInfo={fileInfo} />
              ))}
            </div>
          </div>
        )}

        {/* Processing Section */}
        {step === "processing" && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-8 text-center">
            <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-600 dark:border-blue-400 mx-auto mb-4"></div>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
              Processing Your Data
            </h2>
            <p className="text-gray-600 dark:text-gray-300 mb-4">
              Analyzing safety, congestion, and equity metrics...
            </p>
            <div className="space-y-2 text-sm text-gray-500 dark:text-gray-400">
              <p>• Calculating crash frequency and severity scores</p>
              <p>• Analyzing traffic demand and congestion levels</p>
              <p>• Evaluating access to jobs and non-work destinations</p>
              <p>• Computing benefit-cost ratios</p>
            </div>
          </div>
        )}

        {/* Results Section */}
        {step === "results" && results && (
          <div className="space-y-6">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                  Project Prioritization Results
                </h2>
                <button
                  onClick={downloadResults}
                  className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 dark:bg-green-500 dark:hover:bg-green-600"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Export Results
                </button>
              </div>

              <div className="mb-4 grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-blue-100 dark:bg-blue-900/50 rounded-lg p-4 text-center">
                  <h3 className="text-lg font-medium text-blue-800 dark:text-blue-200">
                    Total Projects
                  </h3>
                  <p className="text-2xl font-bold text-blue-700 dark:text-blue-300">
                    {results.projects.length}
                  </p>
                </div>
                <div className="bg-green-100 dark:bg-green-900/50 rounded-lg p-4 text-center">
                  <h3 className="text-lg font-medium text-green-800 dark:text-green-200">
                    Top Ranked BCR
                  </h3>
                  <p className="text-2xl font-bold text-green-700 dark:text-green-300">
                    {results.projects[0]?.bcr.toFixed(2)}
                  </p>
                </div>
                <div className="bg-purple-100 dark:bg-purple-900/50 rounded-lg p-4 text-center">
                  <h3 className="text-lg font-medium text-purple-800 dark:text-purple-200">
                    Total Cost
                  </h3>
                  <p className="text-2xl font-bold text-purple-700 dark:text-purple-300">
                    $
                    {results.projects
                      .reduce((sum, p) => sum + p.cost_mil, 0)
                      .toFixed(1)}
                    M
                  </p>
                </div>
              </div>

              <ResultsTable data={results.projects} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default STBGFrontend;
