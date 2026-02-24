document.addEventListener('DOMContentLoaded', () => {
  // Use production backend URL from environment or default to Render backend
  const BACKEND_URL = window.location.hostname === 'localhost' 
    ? 'http://localhost:3001'
    : 'https://afdmi-123.onrender.com';
  
  const PYTHON_SERVICE_API = window.location.hostname === 'localhost' 
    ? 'http://localhost:5001'
    : `${BACKEND_URL}/python`; // Python service proxied through backend
  
  const NODE_API = `${BACKEND_URL}/api`; // Node.js backend for other operations

  // ---- Tab Navigation ----
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(tab.dataset.tab).classList.add('active');
    });
  });

  // ---- Document Ingestion ----
  let ingestedFiles = [];
  let selectedDocContent = null;

  // Data source selection
  const sourceFileUpload = document.getElementById('sourceFileUpload');
  const sourceExistingData = document.getElementById('sourceExistingData');
  const fileUploadSection = document.getElementById('fileUploadSection');
  const existingDataSection = document.getElementById('existingDataSection');
  const existingDataSelect = document.getElementById('existingDataSelect');

  // File upload elements
  const dropZone = document.getElementById('dropZone');
  const browseBtn = document.getElementById('browseBtn');
  const fileInput = document.getElementById('fileInput');
  const fileList = document.getElementById('fileList');

  // Event listeners for data source selection
  if (sourceFileUpload && sourceExistingData) {
    sourceFileUpload.addEventListener('change', () => {
      fileUploadSection.style.display = 'block';
      existingDataSection.style.display = 'none';
    });
    
    sourceExistingData.addEventListener('change', () => {
      fileUploadSection.style.display = 'none';
      existingDataSection.style.display = 'block';
      loadExistingData();
    });
  }

  // File upload functionality
  if (dropZone) {
    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      if (e.dataTransfer.files.length) handleFileSelect(e.dataTransfer.files);
    });
  }
  
  if (browseBtn) {
    browseBtn.addEventListener('click', () => fileInput.click());
  }
  
  if (fileInput) {
    fileInput.addEventListener('change', (e) => handleFileSelect(e.target.files || []));
  }

  // Load existing data on page load
  if (existingDataSection) {
    loadExistingData();
  }

  function handleFileSelect(files) {
    const allowed = [...files].filter(f => /\.(pdf|csv)$/i.test(f.name));
    
    // Check file count limit (20 files)
    if (allowed.length > 20) {
      alert('Maximum 20 files allowed. Please select fewer files.');
      return;
    }
    
    // Check file size limit (15MB per file)
    const maxSize = 15 * 1024 * 1024; // 15MB in bytes
    const oversizedFiles = allowed.filter(f => f.size > maxSize);
    
    if (oversizedFiles.length > 0) {
      alert(`The following files exceed the 15MB limit: ${oversizedFiles.map(f => f.name).join(', ')}`);
      return;
    }
    
    // Store files for processing
    ingestedFiles = Array.from(allowed);
    const fileCount = document.getElementById('fileCount');
    if (fileCount) fileCount.textContent = `${ingestedFiles.length} file(s) ready`;
    fileList.innerHTML = ingestedFiles.map(f => `<li>${f.name} (${formatBytes(f.size)})</li>`).join('');
    
    if (ingestedFiles.length > 0) {
      selectedDocContent = ingestedFiles[0];
      const sel = document.getElementById('docSelect');
      const docSel = document.getElementById('docSelector');
      if (sel) sel.innerHTML = ingestedFiles.map((f, i) => `<option value="${i}">${f.name}</option>`).join('');
      if (docSel) docSel.classList.toggle('hidden', ingestedFiles.length <= 1);
    }
  }

  function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  async function loadExistingData() {
    if (!existingDataSelect) return;
    
    try {
      const response = await fetch(`${NODE_API}/surveys`);
      const surveys = await response.json();
      
      if (surveys && surveys.length > 0) {
        existingDataSelect.innerHTML = surveys.map(survey => 
          `<option value="${survey.id}">${survey.title}</option>`
        ).join('');
      } else {
        existingDataSelect.innerHTML = '<option value="">No surveys available</option>';
      }
    } catch (error) {
      console.error('Error loading surveys:', error);
      existingDataSelect.innerHTML = '<option value="">Error loading surveys</option>';
    }
  }

  // ---- Data Ingestion & Analysis ----
  const startIngestionBtn = document.getElementById('startIngestionBtn');
  const processingLogs = document.getElementById('processingLogs');
  const resultsTable = document.getElementById('resultsTable');
  const copyResultsBtn = document.getElementById('copyResultsBtn');
  const downloadResultsBtn = document.getElementById('downloadResultsBtn');
  const ingestionHistoryTable = document.getElementById('ingestionHistoryTable');

  let lastExtractionResult = null;
  let lastExtractionCSV = '';

  if (startIngestionBtn) {
    startIngestionBtn.addEventListener('click', async () => {
      await startIngestionJob();
    });
  }

  if (copyResultsBtn) {
    copyResultsBtn.addEventListener('click', () => {
      if (!lastExtractionResult) return;
      const text = lastExtractionCSV || JSON.stringify(lastExtractionResult, null, 2);
      navigator.clipboard.writeText(text);
      copyResultsBtn.textContent = 'Copied!';
      setTimeout(() => copyResultsBtn.textContent = 'Copy to Clipboard', 1500);
    });
  }

  if (downloadResultsBtn) {
    downloadResultsBtn.addEventListener('click', () => {
      if (!lastExtractionResult) return;
      
      const blob = new Blob([lastExtractionCSV], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'extracted_data.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  }

  async function startIngestionJob() {
    const dataSource = document.querySelector('input[name="dataSource"]:checked').value;
    const modelSelect = document.getElementById('modelSelect');
    const modelParams = document.getElementById('modelParams');
    
    const modelType = modelSelect.value;
    const params = modelParams.value.trim();
    
    if (!modelType) {
      alert('Please select a model');
      return;
    }

    // Show processing status
    processingLogs.textContent = 'Starting job...';
    startIngestionBtn.disabled = true;

    try {
      let result;
      
      if (dataSource === 'file') {
        // Process uploaded files
        if (ingestedFiles.length === 0) {
          alert('Please upload files first');
          return;
        }
        
        result = await processUploadedFiles(modelType, params);
      } else {
        // Process existing data
        const existingDataSelect = document.getElementById('existingDataSelect');
        const surveyId = existingDataSelect.value;
        
        if (!surveyId) {
          alert('Please select a survey');
          return;
        }
        
        result = await processExistingData(surveyId, modelType, params);
      }

      // Display results
      displayResults(result);
      
      // Add to history
      addToHistory(dataSource, modelType, 'Completed');
      
    } catch (error) {
      processingLogs.textContent = `Error: ${error.message}`;
      addToHistory(dataSource, modelType, 'Failed');
    } finally {
      startIngestionBtn.disabled = false;
    }
  }

  async function processUploadedFiles(modelType, params) {
    if (ingestedFiles.length === 0) {
      throw new Error('No files to process');
    }

    // Process files in batches
    const batchSize = 5; // Process 5 files at a time
    const results = [];
    const errors = [];
    
    processingLogs.textContent = `Processing ${ingestedFiles.length} files in batches...`;
    
    for (let i = 0; i < ingestedFiles.length; i += batchSize) {
      const batch = ingestedFiles.slice(i, i + batchSize);
      const batchPromises = batch.map(async (file) => {
        try {
          const result = await processSingleFile(file, modelType, params);
          return { file, result, error: null };
        } catch (error) {
          return { file, result: null, error: error.message };
        }
      });
      
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults.filter(r => r.result));
      errors.push(...batchResults.filter(r => r.error));
      
      // Update progress
      const processed = Math.min(i + batchSize, ingestedFiles.length);
      processingLogs.textContent = `Processing files... ${processed}/${ingestedFiles.length} completed`;
      
      // Small delay between batches to prevent overwhelming the server
      if (i + batchSize < ingestedFiles.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    // Combine all results
    if (results.length > 0) {
      const combinedResult = combineResults(results.map(r => r.result));
      processingLogs.textContent = `Processing complete! ${results.length} files processed successfully`;
      return combinedResult;
    }
    
    if (errors.length > 0) {
      throw new Error(`All files failed to process: ${errors.map(e => e.file.name + ': ' + e.error).join(', ')}`);
    }
    
    throw new Error('No files were processed successfully');
  }

  async function processSingleFile(file, modelType, params) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('prompt', getPromptForModel(modelType, params));

    const response = await fetch(`${PYTHON_SERVICE_API}/process`, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP ${response.status}`);
    }

    const result = await response.json();
    if (!result.success) {
      throw new Error(result.error || 'Extraction failed');
    }

    return result;
  }

  function combineResults(results) {
    if (results.length === 0) {
      return { extractions: [], headers: [], display_headers: [] };
    }

    // Combine all extractions
    const allExtractions = results.flatMap(r => r.extractions || []);
    const allHeaders = [...new Set(results.flatMap(r => r.headers || []))];
    const allDisplayHeaders = [...new Set(results.flatMap(r => r.display_headers || []))];
    
    return {
      extractions: allExtractions,
      headers: allHeaders,
      display_headers: allDisplayHeaders,
      metadata: {
        batch_processing: true,
        total_files: results.length,
        combined_records: allExtractions.length
      }
    };
  }

  async function processExistingData(surveyId, modelType, params) {
    // For now, simulate processing existing data
    // In a real implementation, this would fetch the survey data
    processingLogs.textContent = 'Processing existing data...';
    
    // Simulate API call to get survey data
    const surveyData = await fetch(`${NODE_API}/surveys`)
      .then(r => r.json())
      .then(surveys => surveys.find(s => s.id === surveyId));
    
    if (!surveyData) {
      throw new Error('Survey data not found');
    }

    // Convert survey data to text for processing
    const textData = JSON.stringify(surveyData, null, 2);
    
    const response = await fetch(`${PYTHON_SERVICE_API}/extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: textData,
        prompt: getPromptForModel(modelType, params),
        columns: ['Field', 'Value', 'Type']
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    
    if (result.error) {
      throw new Error(result.error);
    }

    processingLogs.textContent = 'Processing complete!';
    return result;
  }

  function getPromptForModel(modelType, params) {
    const modelPrompts = {
      'ocr_standard': 'Extract all text content from this document using standard OCR techniques',
      'ocr_handwriting': 'Extract handwritten text from this document with special attention to form fields',
      'data_classification': 'Classify and categorize the data in this document',
      'auto_clean': 'Clean and normalize the data, removing duplicates and fixing formatting issues',
      'regression': 'Perform regression analysis on the numerical data in this document',
      'ols': 'Perform Ordinary Least Squares regression analysis on the data'
    };

    let prompt = modelPrompts[modelType] || 'Extract relevant data from this document';
    
    if (params) {
      try {
        const parsedParams = JSON.parse(params);
        prompt += ' with parameters: ' + JSON.stringify(parsedParams);
      } catch (e) {
        prompt += ' with parameters: ' + params;
      }
    }

    return prompt;
  }

  function displayResults(result) {
    if (!result.extractions || result.extractions.length === 0) {
      resultsTable.innerHTML = '<p>No data extracted</p>';
      lastExtractionResult = [];
      lastExtractionCSV = '';
      return;
    }

    // Render table
    const data = result.extractions;
    const headers = result.headers || Object.keys(data[0]);
    const displayHeaders = result.display_headers || headers.map(h => h.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()));
    
    let tableHtml = '<div class="table-container"><table class="results-table"><thead><tr>';
    displayHeaders.forEach(header => {
      tableHtml += `<th>${header}</th>`;
    });
    tableHtml += '</tr></thead><tbody>';
    
    data.forEach(row => {
      tableHtml += '<tr>';
      headers.forEach(header => {
        tableHtml += `<td>${row[header] || ''}</td>`;
      });
      tableHtml += '</tr>';
    });
    
    tableHtml += '</tbody></table></div>';
    resultsTable.innerHTML = tableHtml;
    
    lastExtractionResult = data;
    
    // Generate CSV
    lastExtractionCSV = generateCSV(data, headers, displayHeaders);
  }

  function generateCSV(data, headers, displayHeaders) {
    if (!Array.isArray(data) || data.length === 0) {
      return "";
    }
    
    const csvRows = [displayHeaders.join(',')];

    for (const row of data) {
      const values = headers.map(header => {
        let cell = row[header] === null || row[header] === undefined ? '' : row[header];
        cell = String(cell);
        if (cell.includes('"')) {
          cell = cell.replace(/"/g, '""');
        }
        if (cell.includes(',') || cell.includes('\n') || cell.includes('"')) {
          cell = `"${cell}"`;
        }
        return cell;
      });
      csvRows.push(values.join(','));
    }
    return csvRows.join('\n');
  }

  function addToHistory(dataSource, modelType, status) {
    const timestamp = new Date().toLocaleString();
    const row = document.createElement('tr');
    
    const dataSourceCell = document.createElement('td');
    dataSourceCell.textContent = dataSource === 'file' ? 'Uploaded Files' : 'Existing Data';
    
    const modelCell = document.createElement('td');
    modelCell.textContent = modelType;
    
    const statusCell = document.createElement('td');
    statusCell.textContent = status;
    statusCell.className = status === 'Completed' ? 'status-success' : 'status-error';
    
    const timeCell = document.createElement('td');
    timeCell.textContent = timestamp;
    
    const actionsCell = document.createElement('td');
    const viewBtn = document.createElement('button');
    viewBtn.className = 'btn btn-sm';
    viewBtn.textContent = 'View';
    viewBtn.onclick = () => displayResultsFromHistory(lastExtractionResult);
    actionsCell.appendChild(viewBtn);
    
    row.appendChild(dataSourceCell);
    row.appendChild(modelCell);
    row.appendChild(statusCell);
    row.appendChild(timeCell);
    row.appendChild(actionsCell);
    
    ingestionHistoryTable.querySelector('tbody').prepend(row);
  }

  function displayResultsFromHistory(data) {
    if (!data || data.length === 0) {
      resultsTable.innerHTML = '<p>No data available</p>';
      return;
    }
    
    const headers = Object.keys(data[0]);
    const displayHeaders = headers.map(h => h.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()));
    
    let tableHtml = '<div class="table-container"><table class="results-table"><thead><tr>';
    displayHeaders.forEach(header => {
      tableHtml += `<th>${header}</th>`;
    });
    tableHtml += '</tr></thead><tbody>';
    
    data.forEach(row => {
      tableHtml += '<tr>';
      headers.forEach(header => {
        tableHtml += `<td>${row[header] || ''}</td>`;
      });
      tableHtml += '</tr>';
    });
    
    tableHtml += '</tbody></table></div>';
    resultsTable.innerHTML = tableHtml;
  }

  function renderTable(data) {
      if (!data || data.length === 0) return;
      
      const headers = Object.keys(data[0]);
      let tableHtml = '<div style="overflow-x: auto;"><table style="width: 100%; border-collapse: collapse; font-size: 0.9rem;">';
      
      // Header
      tableHtml += '<thead><tr style="background-color: var(--bg-input); text-align: left;">';
      headers.forEach(h => {
          // Convert snake_case back to Title Case for display
          const title = h.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
          tableHtml += `<th style="padding: 10px; border-bottom: 2px solid var(--border);">${title}</th>`;
      });
      tableHtml += '</tr></thead>';
      
      // Body
      tableHtml += '<tbody>';
      data.forEach(row => {
          tableHtml += '<tr style="border-bottom: 1px solid var(--border);">';
          headers.forEach(h => {
              tableHtml += `<td style="padding: 10px;">${row[h] || ''}</td>`;
          });
          tableHtml += '</tr>';
      });
      tableHtml += '</tbody></table></div>';
      
      extractOutput.innerHTML = tableHtml;
  }

  if (copyOutput) {
    copyOutput.addEventListener('click', () => {
      if (!lastExtractionResult) return;
      const text = JSON.stringify(lastExtractionResult, null, 2);
      navigator.clipboard.writeText(text);
      copyOutput.textContent = 'Copied!';
      setTimeout(() => copyOutput.textContent = 'Copy to Clipboard', 1500);
    });
  }

  if (downloadOutput) {
    downloadOutput.addEventListener('click', () => {
      if (!lastExtractionResult) return;
      
      if (outputFormat.value === 'csv') {
          const csvString = jsonToCsv(lastExtractionResult);
          const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
          downloadBlob(blob, 'extracted_data.csv');
      } else {
          const jsonString = JSON.stringify(lastExtractionResult, null, 2);
          const blob = new Blob([jsonString], { type: 'application/json' });
          downloadBlob(blob, 'extracted_data.json');
      }
    });
  }

  const downloadBlob = (blob, filename) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
  };

  const jsonToCsv = (jsonData) => {
      if (!Array.isArray(jsonData) || jsonData.length === 0) {
          return "";
      }
      const headers = Object.keys(jsonData[0]);
      // Convert snake_case headers to Title Case for CSV export
      const displayHeaders = headers.map(h => h.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()));
      
      const csvRows = [displayHeaders.join(',')];

      for (const row of jsonData) {
          const values = headers.map(header => {
              let cell = row[header] === null || row[header] === undefined ? '' : row[header];
              cell = String(cell);
              if (cell.includes('"')) {
                  cell = cell.replace(/"/g, '""');
              }
              if (cell.includes(',') || cell.includes('\n') || cell.includes('"')) {
                  cell = `"${cell}"`;
              }
              return cell;
          });
          csvRows.push(values.join(','));
      }
      return csvRows.join('\n');
  };

  // ---- Analog Metadata ----
  const analogDropzone = document.getElementById('analogDropzone');
  const analogFileInput = document.getElementById('analogFileInput');
  const analogFileCount = document.getElementById('analogFileCount');
  const analogStatus = document.getElementById('analogStatus');

  if (analogDropzone) {
    analogDropzone.addEventListener('click', () => analogFileInput.click());
    analogDropzone.addEventListener('dragover', (e) => { e.preventDefault(); analogDropzone.classList.add('dragover'); });
    analogDropzone.addEventListener('dragleave', () => analogDropzone.classList.remove('dragover'));
    analogDropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      analogDropzone.classList.remove('dragover');
      if (e.dataTransfer.files.length) uploadAnalogMetadata(e.dataTransfer.files);
    });
  }
  
  if (analogFileInput) {
    analogFileInput.addEventListener('change', (e) => uploadAnalogMetadata(e.target.files || []));
  }

  function uploadAnalogMetadata(files) {
    const allowed = [...files].filter(f => /\.(pdf|csv)$/i.test(f.name)).slice(0, 30);
    const formData = new FormData();
    allowed.forEach(f => formData.append('files', f));
    fetch(`${API}/documents/analog-metadata`, { method: 'POST', body: formData })
      .then(r => r.json())
      .then(res => {
        if (res.error) throw new Error(res.error);
        analogFileCount.textContent = `${res.files.length} file(s)`;
        analogStatus.innerHTML = res.files.map(f => `<div>${f.filename}: ${f.summary}</div>`).join('');
      })
      .catch(err => alert('Upload failed: ' + err.message));
  }

  // ---- Data Terminal ----
  const csvInput = document.getElementById('csvInput');
  const csvFileInput = document.getElementById('csvFileInput');
  const uploadCsvBtn = document.getElementById('uploadCsvBtn');
  const commandInput = document.getElementById('commandInput');
  const executeBtn = document.getElementById('executeBtn');
  const terminalOutput = document.getElementById('terminalOutput');
  const chartContainer = document.getElementById('chartContainer');
  const chartCanvas = document.getElementById('chartCanvas');
  const outputTabs = document.querySelectorAll('.output-tab');

  let chartInstance = null;

  if (uploadCsvBtn) {
    uploadCsvBtn.addEventListener('click', () => csvFileInput.click());
  }
  
  if (csvFileInput) {
    csvFileInput.addEventListener('change', (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => { csvInput.value = r.result; };
      r.readAsText(f);
    });
  }

  outputTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      outputTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const showChart = tab.dataset.output === 'chart';
      chartContainer.classList.toggle('hidden', !showChart);
      terminalOutput.classList.toggle('hidden', showChart);
    });
  });

  if (executeBtn) {
    executeBtn.addEventListener('click', executeCommand);
  }
  
  if (commandInput) {
    commandInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') executeCommand(); });
  }

  function executeCommand() {
    const csvData = csvInput.value.trim();
    const command = commandInput.value.trim();
    if (!csvData) { alert('Paste or upload CSV data first'); return; }
    if (!command) { alert('Enter a command'); return; }

    fetch(`${API}/terminal/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csvData, command })
    })
    .then(r => r.json())
    .then(res => {
      if (res.error) throw new Error(res.error);
      terminalOutput.innerHTML = '';
      terminalOutput.appendChild(document.createTextNode(res.textOutput || 'No output'));
      terminalOutput.classList.remove('hidden');
      chartContainer.classList.add('hidden');
      outputTabs.forEach(t => t.classList.remove('active'));
      outputTabs[0].classList.add('active');

      if (res.chartData) {
        if (res.command === 'linear_regression') renderRegressionChart(res.chartData);
        else if (res.command === 'histogram') renderHistogramChart(res.chartData);
      }
    })
    .catch(err => {
      terminalOutput.innerHTML = '';
      terminalOutput.appendChild(document.createTextNode('Error: ' + err.message));
      terminalOutput.classList.remove('hidden');
      chartContainer.classList.add('hidden');
    });
  }

  function renderRegressionChart(data) {
    if (chartInstance) chartInstance.destroy();
    const ctx = chartCanvas.getContext('2d');
    const { x, y, slope, intercept } = data;
    const minX = Math.min(...x), maxX = Math.max(...x);
    const padding = (maxX - minX) * 0.1 || 1;
    const lineX = [minX - padding, maxX + padding];
    const lineY = lineX.map(xi => slope * xi + intercept);

    chartInstance = new Chart(ctx, {
      type: 'scatter',
      data: {
        datasets: [
          {
            label: 'Actual data',
            data: x.map((xi, i) => ({ x: xi, y: y[i] })),
            backgroundColor: 'rgba(88, 166, 255, 0.6)',
            borderColor: 'rgba(88, 166, 255, 1)',
            pointRadius: 6
          },
          {
            label: 'Regression line',
            data: lineX.map((xi, i) => ({ x: xi, y: lineY[i] })),
            type: 'line',
            borderColor: 'rgba(63, 185, 80, 1)',
            borderWidth: 2,
            pointRadius: 0,
            tension: 0
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#e6edf3' } } },
        scales: {
          x: { ticks: { color: '#8b949e' }, grid: { color: '#2d3a4d' } },
          y: { ticks: { color: '#8b949e' }, grid: { color: '#2d3a4d' } }
        }
      }
    });
  }

  function renderHistogramChart(data) {
    if (chartInstance) chartInstance.destroy();
    const ctx = chartCanvas.getContext('2d');
    chartInstance = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: data.labels,
        datasets: [{
          label: data.column || 'Count',
          data: data.values,
          backgroundColor: 'rgba(88, 166, 255, 0.5)',
          borderColor: 'rgba(88, 166, 255, 1)',
          borderWidth: 1
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#e6edf3' } } },
        scales: {
          x: { ticks: { color: '#8b949e', maxRotation: 45 }, grid: { color: '#2d3a4d' } },
          y: { ticks: { color: '#8b949e' }, grid: { color: '#2d3a4d' } }
        }
      }
    });
  }
});
